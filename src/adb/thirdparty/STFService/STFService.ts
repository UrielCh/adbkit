import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { Duplex } from 'node:stream';
import fs from 'node:fs';

import DeviceClient from '../../DeviceClient.js';
import PromiseDuplex from 'promise-duplex';
import ThirdUtils from '../ThirdUtils.js';
import * as STF from './STFServiceModel.js';
// import * as STFAg from "./STFAgentModel.js";
import * as protobuf from 'protobufjs';
import STFServiceBuf from './STFServiceBuf.js';
import Utils from '../../utils.js';

const { Reader } = protobuf;


interface IEmissions {
  airplaneMode: (data: STF.AirplaneModeEvent) => void
  battery: (data: STF.BatteryEvent) => void
  connectivity: (data: STF.ConnectivityEvent) => void
  phoneState: (data: STF.PhoneStateEvent) => void
  rotation: (data: STF.RotationEvent) => void
  browerPackage: (data: STF.BrowserPackageEvent) => void
  error: (data: Error) => void
  disconnect: () => void
}

export interface STFServiceOptions {
  /**
   * calls timeout default is 15000 ms
   */
  timeout: number,
  /**
   * do not install the APK, if you use a custom apk
   */
  noInstall: boolean;
}

// const debug = Debug('STFService');
const PKG = 'jp.co.cyberagent.stf';

export default class STFService extends EventEmitter {
  private config: STFServiceOptions;
  private servicesSocket: PromiseDuplex<Duplex> | undefined;
  private protoSrv!: STFServiceBuf;

  private _maxContact: Promise<number>;
  private _width: Promise<number>;
  private _height: Promise<number>;
  private _maxPressure: Promise<number>;

  private setMaxContact!: (width: number) => void;
  private setWidth!: (height: number) => void;
  private setHeight!: (height: number) => void;
  private setMaxPressure!: (height: number) => void;

  constructor(private client: DeviceClient, options = {} as Partial<STFServiceOptions>) {
    super();
    this.config = {
      timeout: 15000,
      noInstall: false,
      ...options,
    }
    this._maxContact = new Promise<number>((resolve) => this.setMaxContact = resolve);
    this._width = new Promise<number>((resolve) => this.setWidth = resolve);
    this._height = new Promise<number>((resolve) => this.setHeight = resolve);
    this._maxPressure = new Promise<number>((resolve) => this.setMaxPressure = resolve);
  }

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  get maxContact(): Promise<number> { return this._maxContact; }
  get width(): Promise<number> { return this._width; }
  get height(): Promise<number> { return this._height; }
  get maxPressure(): Promise<number> { return this._maxPressure; }

  /**
   * find the APK and install it
   */
  private async installApk(version: string): Promise<boolean> {
    const apk = ThirdUtils.getResourcePath(`STFService_${version}.apk`);
    try {
      await fs.promises.stat(apk);
    } catch (e) {
      throw Error(`can not find APK bin/STFService_${version}.apk Err: ${JSON.stringify(e)}`);
    }
    this._cachedApkPath = '';
    return this.client.install(apk);
  }


  private _cachedApkPath = '';
  /**
   * 
   * @returns get agent setup path
   */
  private async getApkPath(): Promise<string> {
    if (this._cachedApkPath)
      return this._cachedApkPath;
    /**
     * locate the installed apk file
     */
    let setupPath = (await this.client.execOut(`pm path ${PKG}`, 'utf8')).trim();
    if (!setupPath.startsWith('package:')) {
      return '';
      // throw new Error(`Failed to find ${PKG} package path`);
    }
    setupPath = setupPath.substring(8);
    this._cachedApkPath = setupPath;
    return setupPath;
  }

  /**
   * get the current installed Agent version number
   * @returns 'MISSING' if not installed, 'OK' if expected, 'MISMATCH' if version differ
   */
  private async checkVersion(version: string): Promise<'OK' | 'MISMATCH' | 'MISSING'> {
    const setupPath = await this.getApkPath();
    const getVersion = `export CLASSPATH='${setupPath}'; exec app_process /system/bin '${PKG}.Agent' --version 2>/dev/null`
    const currentVersion = await this.client.execOut(getVersion, 'utf8');
    if (!currentVersion)
      return 'MISSING';
    if (currentVersion.trim() !== version) {
      return 'MISMATCH';
    }
    return 'OK';
  }

  /**
    * start agent
    */
  private async startAgent() {
    const setupPath = await this.getApkPath();
    const startAgent = `export CLASSPATH='${setupPath}'; exec app_process /system/bin '${PKG}.Agent' 2>&1`
    const agentProcess = new PromiseDuplex(await this.client.exec(startAgent));
    const result = await Utils.waitforText(agentProcess, /@stfagent|Address already in use/, 10000);
    if (result.includes("@stfagent"))
      return; // started
    // console.log(`${this.client.serial} stfagent already running`);
    // debug only
    // ThirdUtils.dumpReadable(agentProcess, 'STFagent');
  }

  /**
   * start long running service and keep the duplex opened
   */
  private async startService(): Promise<void> {
    const props = await this.client.getProperties();
    const action = `${PKG}.ACTION_START`;
    const component = `${PKG}/.Service`;
    const sdkLevel = parseInt(props['ro.build.version.sdk']);
    const startServiceCmd = (sdkLevel < 26) ? 'startservice' : 'start-foreground-service'
    const duplex = new PromiseDuplex(await this.client.shell(`am ${startServiceCmd} --user 0 -a '${action}' -n '${component}'`));
    await Utils.waitforReadable(duplex);
    const msg = await (duplex.setEncoding('utf8').readAll() as Promise<string>);
    if (msg.includes('Error')) {
      throw Error(msg.trim())
    }
  }

  /**
   * uninstall the service
   */
  public async uninstall(): Promise<boolean> {
    await this.client.uninstall(PKG);
    await this.client.execOut('rm -f /data/local/tmp/minicap /data/local/tmp/minicap.so /data/local/tmp/minitouch /data/local/tmp/minirev');
    return true;
  }

  async start(): Promise<this> {
    this.protoSrv = await STFServiceBuf.get();
    if (!this.config.noInstall) {
      const versionStatus = await this.checkVersion('2.4.9');
      if (versionStatus === 'MISMATCH') {
        await this.uninstall();
      }
      if (versionStatus !== 'OK') {
        await this.installApk('2.4.9');
      }
    }
    await this.startService();
    await this.startAgent();
    this.servicesSocket = await this.client.openLocal2('localabstract:stfservice');
    this.servicesSocket.once('close').then(() => this.stop());
    void this.startServiceStream().catch((e) => { console.log('Service failed', e); this.stop() });
    return this;
  }

  private _minitouchagent: Promise<PromiseDuplex<Duplex>> | undefined;
  /**
   * get minitouch duplex, if not connected open connexion
   */
  async getMinitouchSocket(): Promise<PromiseDuplex<Duplex>> {
    if (this._minitouchagent) return this._minitouchagent;
    this._minitouchagent = this.client.openLocal2('localabstract:minitouchagent');
    const socket = await this._minitouchagent;
    socket.once('close').then(() => {
      this._minitouchagent = undefined;
      // console.log('getMinitouchSocket just closed');
    });
    void this.startMinitouchStream(socket).catch(() => { socket.destroy() });
    return socket;
  }

  private _agentSocket: Promise<PromiseDuplex<Duplex>> | undefined;
  async getAgentSocket(): Promise<PromiseDuplex<Duplex>> {
    if (this._agentSocket) return this._agentSocket;
    this._agentSocket = this.client.openLocal2('localabstract:stfagent');
    const socket = await this._agentSocket;
    socket.once('close').then(() => {
      this._agentSocket = undefined;
      // console.log('agentSocket just closed');
    });
    void this.startAgentStream(socket).catch(() => { socket.destroy() });
    return this._agentSocket;
  }

  private async startServiceStream() {
    let buffer: Buffer | null = null;
    for (; ;) {
      await Utils.waitforReadable(this.servicesSocket);
      if (!this.servicesSocket)
        return;
      const next = await this.servicesSocket.read() as Buffer;
      if (!next) continue;
      if (buffer) {
        buffer = Buffer.concat([buffer as unknown as Uint8Array, next as unknown as Uint8Array]);
      } else {
        buffer = next;
      }
      while (buffer) {
        const reader = Reader.create(buffer as unknown as Uint8Array);
        const envelopLen = reader.uint32();
        const bufLen = envelopLen + reader.pos;
        // need mode data to complet envelop
        if ((buffer as unknown as Uint8Array).length < envelopLen) break;

        let chunk: Buffer;
        if (bufLen === (buffer as unknown as Uint8Array).length) {
          // chunk len match Envelop len should speedup parsing, depending on nodeJS internal Buffer implementation, need to check Buffer.subarray implementation
          chunk = buffer.subarray(reader.pos);
          buffer = null;
        } else {
          chunk = buffer.subarray(reader.pos, bufLen);
          buffer = buffer.subarray(bufLen);
        }
        try {
          const eventObj = this.protoSrv.readEnvelope(chunk as unknown as Uint8Array);
          const { id, message } = eventObj;
          if (id) {
            const resolv = this.responseHook[id];
            if (resolv) {
              delete this.responseHook[id];
              resolv(message);
            } else {
              console.error(`STFService RCV response to unknown QueryId:${id} Type:${eventObj.type}`);
            }
            continue;
          }
          switch (eventObj.type) {
            case STF.MessageTypeMap.EVENT_AIRPLANE_MODE: this.emit("airplaneMode", this.protoSrv.read.AirplaneModeEvent(message)); break;
            case STF.MessageTypeMap.EVENT_BATTERY: this.emit("battery", this.protoSrv.read.BatteryEvent(message)); break;
            case STF.MessageTypeMap.EVENT_CONNECTIVITY: this.emit("connectivity", this.protoSrv.read.ConnectivityEvent(message)); break;
            case STF.MessageTypeMap.EVENT_ROTATION: this.emit("rotation", this.protoSrv.read.RotationEvent(message)); break;
            case STF.MessageTypeMap.EVENT_PHONE_STATE: this.emit("phoneState", this.protoSrv.read.PhoneStateEvent(message)); break;
            case STF.MessageTypeMap.EVENT_BROWSER_PACKAGE: this.emit("browerPackage", this.protoSrv.read.BrowserPackageEvent(message)); break;
            default: console.error(`STFService Response Type (${eventObj.type}) is not implemented`);
          }
        } catch (e) {
          if (chunk)
            console.error(chunk.toString('hex'));
          console.error(e);
        }
      }
      await Utils.delay(0);
    }
  }
  /**
   * RCV banne:
   * v 1
   * ^ %d %d %d %d DEFAULT_MAX_CONTACTS, width, height, DEFAULT_MAX_PRESSURE;
   * @param socket 
   */
  private async startMinitouchStream(socket: PromiseDuplex<Duplex>): Promise<void> {
    socket.setEncoding('ascii');
    let data = '';
    for (; ;) {
      await Utils.waitforReadable(socket);
      const chunk = await socket.read();
      if (!chunk)
        return;
      data = data + chunk as string;
      for (; ;) {
        const p = data.indexOf('\n');
        if (p >= 0)
          break;
        const line = data.substring(0, p);
        data = data.substring(p + 1);

        if (line.startsWith('v 1'))
          continue;
        if (line.startsWith('^')) {
          const [, mc, w, h, mp] = line.split(/ /);
          this.setMaxContact(Number(mc));
          this.setWidth(Number(w));
          this.setHeight(Number(h));
          this.setMaxPressure(Number(mp));
          continue;
        }
        console.error('minitouchSocket RCV chunk len:', line);
      }
      await Utils.delay(0);
    }
  }

  private async startAgentStream(socket: PromiseDuplex<Duplex>): Promise<void> {
    for (; ;) {
      await Utils.waitforReadable(socket);
      const chunk = await socket.read() as Buffer;
      if (chunk) {
        console.log('agentSocket RCV chunk len:', (chunk as unknown as Uint8Array).length, chunk.toString('hex').substring(0, 80));
      } else {
        return;
      }
      await Utils.delay(0);
    }
  }
  /**
   * esponce callback hooks
   */
  private responseHook: { [key: number]: (response: Uint8Array) => void } = {}
  /**
   * request id counter [1..0xFFFFFF]
   */
  private reqCnt = 1;

  /**
   * Generic method to push message to service
   */
  private pushService(type: STF.MessageType, message: Uint8Array | Buffer, requestReader?: null): Promise<void>;
  private pushService<T>(type: STF.MessageType, message: Uint8Array | Buffer, requestReader?: ((req: Uint8Array) => T)): Promise<T>;
  private pushService<T>(type: STF.MessageType, message: Uint8Array | Buffer, requestReader?: null | ((req: Uint8Array) => T)): Promise<T | void> {
    const id = (this.reqCnt + 1) | 0xFFFFFF;
    this.reqCnt = id;
    const envelope = { type, message: message as Uint8Array, id };
    let pReject: (error: Error) => void;
    const promise = new Promise<T | void>((resolve, reject) => {
      pReject = reject;
      this.responseHook[id] = (message: Uint8Array) => {
        if (requestReader) {
          const conv = requestReader(message);
          resolve(conv);
        } else {
          resolve();
        }
      }
    });
    const buf = this.protoSrv.write.Envelope(envelope)
    if (!this.servicesSocket)
      throw Error('servicesSocket is not open');
    this.servicesSocket.write(buf);
    const timeout = Utils.delay(this.config.timeout).then(() => {
      if (this.responseHook[id]) {
        delete this.responseHook[id];
        pReject(Error('timeout'));
      }
    });
    Promise.race([promise, timeout]);
    return promise;
  }

  /**
   * Generic method to push message to agent
   */
  private async pushAgent(type: STF.MessageType, message: Uint8Array | Buffer): Promise<number> {
    const envelope = { type, message: message as Uint8Array };
    // const buf = this.protoAgent.write.Envelope(envelope)
    const buf = this.protoSrv.write.Envelope(envelope)
    const socket = await this.getAgentSocket();
    return socket.write(buf);
  }

  ////////////////////////////
  // public methods

  public getAccounts(type?: string): Promise<STF.GetAccountsResponse> {
    const message = this.protoSrv.write.GetAccountsRequest({ type });
    return this.pushService<STF.GetAccountsResponse>(STF.MessageTypeMap.GET_ACCOUNTS, message, this.protoSrv.read.GetAccountsResponse)
  }

  public getBrowsers(req = {} as STF.GetBrowsersRequest): Promise<STF.GetBrowsersResponse> {
    const message = this.protoSrv.write.GetBrowsersRequest(req);
    return this.pushService<STF.GetBrowsersResponse>(STF.MessageTypeMap.GET_BROWSERS, message, this.protoSrv.read.GetBrowsersResponse)
  }

  public getClipboard(type = STF.ClipboardTypeMap.TEXT): Promise<STF.GetClipboardResponse> {
    const message = this.protoSrv.write.GetClipboardRequest({ type });
    return this.pushService<STF.GetClipboardResponse>(STF.MessageTypeMap.GET_CLIPBOARD, message, this.protoSrv.read.GetClipboardResponse)
  }

  public getDisplay(id = 0): Promise<STF.GetDisplayResponse> {
    const message = this.protoSrv.write.GetDisplayRequest({ id });
    return this.pushService<STF.GetDisplayResponse>(STF.MessageTypeMap.GET_DISPLAY, message, this.protoSrv.read.GetDisplayResponse)
  }

  public getProperties(properties: string[]): Promise<STF.GetPropertiesResponse> {
    const message = this.protoSrv.write.GetPropertiesRequest({ properties });
    return this.pushService<STF.GetPropertiesResponse>(STF.MessageTypeMap.GET_PROPERTIES, message, this.protoSrv.read.GetPropertiesResponse)
  }

  public getRingerMode(req = {} as STF.GetRingerModeRequest): Promise<STF.GetRingerModeResponse> {
    const message = this.protoSrv.write.GetRingerModeRequest(req);
    return this.pushService<STF.GetRingerModeResponse>(STF.MessageTypeMap.GET_RINGER_MODE, message, this.protoSrv.read.GetRingerModeResponse)
  }

  public getSdStatus(req = {} as STF.GetSdStatusRequest): Promise<STF.GetSdStatusResponse> {
    const message = this.protoSrv.write.GetSdStatusRequest(req);
    return this.pushService<STF.GetSdStatusResponse>(STF.MessageTypeMap.GET_SD_STATUS, message, this.protoSrv.read.GetSdStatusResponse)
  }

  // invalid response send by the service
  // public async getVersion(): Promise<STF.GetVersionResponse> {
  //   const message = this.proto.write.GetVersionRequest();
  //   return this.pushEnvelop<STF.GetVersionResponse>(STF.MessageType.GET_VERSION, message })
  // }

  public getWifiStatus(req = {} as STF.GetWifiStatusRequest): Promise<STF.GetWifiStatusResponse> {
    const message = this.protoSrv.write.GetWifiStatusRequest(req);
    return this.pushService<STF.GetWifiStatusResponse>(STF.MessageTypeMap.GET_WIFI_STATUS, message, this.protoSrv.read.GetWifiStatusResponse)
  }

  public getBluetoothStatus(req = {} as STF.GetBluetoothStatusRequest): Promise<STF.GetBluetoothStatusResponse> {
    const message = this.protoSrv.write.GetBluetoothStatusRequest(req);
    return this.pushService<STF.GetBluetoothStatusResponse>(STF.MessageTypeMap.GET_BLUETOOTH_STATUS, message, this.protoSrv.read.GetBluetoothStatusResponse)
  }

  public getRootStatus(req = {} as STF.GetRootStatusRequest): Promise<STF.GetRootStatusResponse> {
    const message = this.protoSrv.write.GetRootStatusRequest(req);
    return this.pushService<STF.GetRootStatusResponse>(STF.MessageTypeMap.GET_ROOT_STATUS, message, this.protoSrv.read.GetRootStatusResponse)
  }

  public setClipboard(req: STF.SetClipboardRequest): Promise<STF.SetClipboardResponse> {
    const message = this.protoSrv.write.SetClipboardRequest(req);
    return this.pushService<STF.SetClipboardResponse>(STF.MessageTypeMap.SET_CLIPBOARD, message, this.protoSrv.read.SetClipboardResponse)
  }

  public setKeyguardState(req: STF.SetKeyguardStateRequest): Promise<STF.SetKeyguardStateResponse> {
    const message = this.protoSrv.write.SetKeyguardStateRequest(req);
    return this.pushService<STF.SetKeyguardStateResponse>(STF.MessageTypeMap.SET_KEYGUARD_STATE, message, this.protoSrv.read.SetKeyguardStateResponse)
  }

  public setRingerMode(req: STF.SetRingerModeRequest): Promise<STF.SetRingerModeResponse> {
    const message = this.protoSrv.write.SetRingerModeRequest(req);
    return this.pushService<STF.SetRingerModeResponse>(STF.MessageTypeMap.SET_RINGER_MODE, message, this.protoSrv.read.SetRingerModeResponse)
  }

  public setRotationRequest(req: STF.SetRotationRequest): Promise<void> {
    const message = this.protoSrv.write.SetRotationRequest(req);
    return this.pushService(STF.MessageTypeMap.SET_ROTATION, message)
  }

  public setWakeLock(req: STF.SetWakeLockRequest): Promise<STF.GetWifiStatusResponse> {
    const message = this.protoSrv.write.SetWakeLockRequest(req);
    return this.pushService<STF.GetWifiStatusResponse>(STF.MessageTypeMap.SET_WAKE_LOCK, message, this.protoSrv.read.GetWifiStatusResponse)
  }

  public setWifiEnabledRequest(req: STF.SetWifiEnabledRequest): Promise<STF.SetWifiEnabledResponse> {
    const message = this.protoSrv.write.SetWifiEnabledRequest(req);
    return this.pushService<STF.SetWifiEnabledResponse>(STF.MessageTypeMap.SET_WIFI_ENABLED, message, this.protoSrv.read.SetWifiEnabledResponse)
  }

  public setBluetoothEnabledRequest(req: STF.SetBluetoothEnabledRequest): Promise<STF.SetBluetoothEnabledResponse> {
    const message = this.protoSrv.write.SetBluetoothEnabledRequest(req);
    return this.pushService<STF.SetBluetoothEnabledResponse>(STF.MessageTypeMap.SET_BLUETOOTH_ENABLED, message, this.protoSrv.read.SetBluetoothEnabledResponse)
  }

  public setMasterMute(req: STF.SetMasterMuteRequest): Promise<STF.SetMasterMuteResponse> {
    const message = this.protoSrv.write.SetMasterMuteRequest(req);
    const ret = this.pushService<STF.SetMasterMuteResponse>(STF.MessageTypeMap.SET_MASTER_MUTE, message, this.protoSrv.read.SetMasterMuteResponse);
    return ret;
  }

  // Agents
  public doKeyEvent(req: STF.KeyEventRequest): Promise<number> {
    const message = this.protoSrv.write.KeyEventRequest(req);
    return this.pushAgent(STF.MessageTypeMap.DO_KEYEVENT, message);
  }
  public doType(req: STF.DoTypeRequest): Promise<number> {
    const message = this.protoSrv.write.DoTypeRequest(req);
    return this.pushAgent(STF.MessageTypeMap.DO_TYPE, message);
  }
  public doWake(req: STF.DoWakeRequest): Promise<number> {
    const message = this.protoSrv.write.DoWakeRequest(req);
    return this.pushAgent(STF.MessageTypeMap.DO_WAKE, message);
  }
  public setRotation(req: STF.SetRotationRequest): Promise<number> {
    const message = this.protoSrv.write.SetRotationRequest(req);
    return this.pushAgent(STF.MessageTypeMap.SET_ROTATION, message);
  }

  /**
   * Send commit minitouch events
   */
  public async commit(): Promise<number> {
    const cmd = `c\n`;
    const s = await this.getMinitouchSocket();
    return s.write(cmd, 'ascii');
  }

  /**
   * Send move minitouch events
   */
  public async move(x: number, y: number, contact = 0 as 0 | 1, pressure = 0): Promise<number> {
    const cmd = `m ${contact | 0} ${x | 0} ${y | 0} ${pressure | 0}\n`;
    const s = await this.getMinitouchSocket();
    return s.write(cmd, 'ascii');
  }

  /**
   * Send press down minitouch events
   */
  public async down(x: number, y: number, contact = 0 as 0 | 1, pressure = 0): Promise<number> {
    const cmd = `d ${contact} ${x | 0} ${y | 0} ${pressure | 0}\n`;
    const s = await this.getMinitouchSocket();
    return s.write(cmd, 'ascii');
  }

  /**
   * Send press up minitouch events
   */
  public async up(contact = 0 as 0 | 1): Promise<number> {
    const cmd = `u ${contact | 0}\n`;
    const s = await this.getMinitouchSocket();
    return s.write(cmd, 'ascii');
  }

  /**
   * Send move + commit minitouch events
   */
  public async moveCommit(x: number, y: number, contact = 0 as 0 | 1, pressure = 0): Promise<number> {
    const cmd = `m ${contact | 0} ${x | 0} ${y | 0} ${pressure | 0}\nc\n`;
    const s = await this.getMinitouchSocket();
    return s.write(cmd, 'ascii');
  }

  /**
   * Send press down + commit minitouch events
   */
  public async downCommit(x: number, y: number, contact = 0 as 0 | 1, pressure = 0): Promise<number> {
    const cmd = `d ${contact} ${x | 0} ${y | 0} ${pressure | 0}\nc\n`;
    const s = await this.getMinitouchSocket();
    return s.write(cmd, 'ascii');
  }

  /**
   * Send press up + commit minitouch events
   */
  public async upCommit(contact = 0 as 0 | 1): Promise<number> {
    const cmd = `u ${contact | 0}\nc\n`;
    const s = await this.getMinitouchSocket();
    return s.write(cmd, 'ascii');
  }

  /**
   * Send wait instruction minitouch events
   */
  public async wait(time: number): Promise<number> {
    const cmd = `w ${time}\n`;
    const s = await this.getMinitouchSocket();
    return s.write(cmd, 'ascii');
  }

  /**
   * stop the service
   */
  public stop(): boolean {
    let close = false;
    if (this.servicesSocket) {
      this.servicesSocket.destroy();
      this.servicesSocket = undefined;
      close = true;
    }
    if (this._agentSocket) {
      this._agentSocket.then(a => a.destroy());
      this._agentSocket = undefined;
      close = true;
    }
    if (this._minitouchagent) {
      this._minitouchagent.then(a => a.destroy());
      this._minitouchagent = undefined;
      close = true;
    }
    if (close)
      this.emit('disconnect');
    return close;
  }
  isRunning(): boolean {
    return this.servicesSocket !== null;
  }
}
