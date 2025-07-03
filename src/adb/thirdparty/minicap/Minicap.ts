import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import { Duplex } from 'node:stream';
import { Buffer } from 'node:buffer';

import DeviceClient from '../../DeviceClient.js';
import PromiseDuplex from 'promise-duplex';
import ThirdUtils from "../ThirdUtils.js";
import Utils from '../../utils.js';
import Stats from '../../sync/stats.js';
import { resolve } from 'import-meta-resolve';

/**
 * Application binary interface known CPU
 */
export type ABI_CPU = 'arm64-v8a' | 'armeabi-v7a' | 'x86' | 'x86_64';

export interface MinicapOptions {
  /**
   * dimention formated as `{RealWidth}x{RealHeight}@{VirtualWidth}x{VirtualHeight}/{Orientation}`
   */
  dimention: string;
}

const debug = Utils.debug('adb:minicap');
/**
 * enforce EventEmitter typing
 */
interface IEmissions {
  data: (data: Buffer) => void
  error: (error: Error) => void
  disconnect: (cause: string) => void
}
// fs.ReadStream | 
function getResource(path: string): string | null {
  try {
    return require.resolve(path);
  } catch (e) {
    try {
      if (e instanceof Error && e.message.includes('require is not defined')) {
        const url = resolve(path, import.meta.url);
        return new URL(url).pathname;
      }
    } catch (e) {
      return null;
    }
    return null;
  }
}

export default class Minicap extends EventEmitter {
  private config: MinicapOptions;
  private videoSocket: PromiseDuplex<Duplex> | undefined;
  private minicapServer: PromiseDuplex<Duplex> | undefined;

  /** 0=255 */
  private _version: Promise<number>;
  private _pid: Promise<number>;
  private _realWidth: Promise<number>;
  private _realHigth: Promise<number>;
  private _virtualWidth: Promise<number>;
  private _virtualHigth: Promise<number>;
  private _orientation: Promise<number>;
  private _bitflags: Promise<number>;
  private _firstFrame: Promise<void>;

  private setVersion!: (version: number) => void;
  private setPid!: (version: number) => void;
  private setRealWidth!: (width: number) => void;
  private setRealHigth!: (height: number) => void;
  private setVirtualWidth!: (width: number) => void;
  private setVirtualHigth!: (height: number) => void;
  private setOrientation!: (height: number) => void;
  private setBitflags!: (height: number) => void;
  private setFirstFrame: (() => void) | null = null;
  /**
   * closed had been call stop all new activity
   */
  private closed = false;

  constructor(private client: DeviceClient, config = {} as Partial<MinicapOptions>) {
    super();
    this.config = {
      dimention: '',
      ...config,
    }
    this._version = new Promise<number>((resolve) => this.setVersion = resolve);
    this._pid = new Promise<number>((resolve) => this.setPid = resolve);
    this._realWidth = new Promise<number>((resolve) => this.setRealWidth = resolve);
    this._realHigth = new Promise<number>((resolve) => this.setRealHigth = resolve);
    this._virtualWidth = new Promise<number>((resolve) => this.setVirtualWidth = resolve);
    this._virtualHigth = new Promise<number>((resolve) => this.setVirtualHigth = resolve);
    this._orientation = new Promise<number>((resolve) => this.setOrientation = resolve);
    this._bitflags = new Promise<number>((resolve) => this.setBitflags = resolve);
    this._firstFrame = new Promise<void>((resolve) => this.setFirstFrame = resolve);
  }

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  get version(): Promise<number> { return this._version; }
  get pid(): Promise<number> { return this._pid; }
  get realwidth(): Promise<number> { return this._realWidth; }
  get realheight(): Promise<number> { return this._realHigth; }
  get vitualWidth(): Promise<number> { return this._virtualWidth; }
  get vitualHeight(): Promise<number> { return this._virtualHigth; }
  /**
   * return virtual width
   */
  get width(): Promise<number> { return this._virtualWidth; }
  /**
   * return virtual heigth
   */
  get height(): Promise<number> { return this._virtualHigth; }

  get orientation(): Promise<number> { return this._orientation; }
  /**
   * return full bitflags, QuickDumb, QuickAlwaysUpright and QuickTear can be used.
   */
  get bitflags(): Promise<number> { return this._bitflags; }
  /**
   * Frames will get sent even if there are no changes from the previous frame. Informative, doesn't require any actions on your part. You can limit the capture rate by reading frame data slower in your own code if you wish.
   */
  get QuickDumb(): Promise<boolean> { return this.bitflags.then(v => !!(v & 1)); }
  /**
   * 	The frame will always be in upright orientation regardless of the device orientation. This needs to be taken into account when rendering the image.
   */
  get QuickAlwaysUpright(): Promise<boolean> { return this.bitflags.then(v => !!(v & 2)); }
  /**
   * Frame tear might be visible. Informative, no action required. Neither of our current two methods exhibit this behavior.
   */
  get QuickTear(): Promise<boolean> { return this.bitflags.then(v => !!(v & 4)); }
  /**
   * Promise to the first emited frame
   * can be used to unsure that scrcpy propery start
   */
  get firstFrame(): Promise<void> { return this._firstFrame; }

  /**
   * 
   * @returns resolved once localabstract:minicap is connected
   */
  async start(): Promise<this> {
    if (this.closed) // can not start once stop called
      return this;
    const props = await this.client.getProperties();
    const abi = props['ro.product.cpu.abi'] as ABI_CPU;
    const sdkLevel = parseInt(props['ro.build.version.sdk']);
    const minicapName = (sdkLevel >= 16) ? 'minicap' : 'minicap-nopie';

    let binFile: string | null = null;
    let soFile: string | null = null;


    binFile = getResource(`@devicefarmer/minicap-prebuilt/prebuilt/${abi}/bin/${minicapName}`);
    if (!binFile)
      throw Error(`minicap not found in @devicefarmer/minicap-prebuilt/prebuilt/${abi}/bin/ please install @devicefarmer/minicap-prebuilt to use minicap`);

    if (sdkLevel === 32) {
      soFile = getResource(`@u4/minicap-prebuilt/prebuilt/${abi}/lib/android-${sdkLevel}/minicap.so`);
    } else {
      soFile = getResource(`@devicefarmer/minicap-prebuilt/prebuilt/${abi}/lib/android-${sdkLevel}/minicap.so`);
    }

    if (!soFile) {
      throw Error(`minicap.so for your device check for @devicefarmer/minicap-prebuilt update that support android-${sdkLevel}, ${soFile} is missing`);
    }

    // only upload minicap binary in tmp filder if file is missing
    try {
      await this.client.stat('/data/local/tmp/minicap');
      debug(`/data/local/tmp/minicap already present in ${this.client.serial}`)
    } catch {
      debug(`pushing minicap binary to ${this.client.serial}`)
      const tr = await this.client.push(binFile, '/data/local/tmp/minicap', 0o755);
      await tr.waitForEnd();
    }

    // only upload minicap.so in tmp filder if file is missing
    const localStats = fs.statSync(soFile);
    let droidStats: Stats | undefined;
    try {
      droidStats = await this.client.stat('/data/local/tmp/minicap.so');
    } catch {
      droidStats = undefined;
    }

    if (!droidStats || droidStats.size !== localStats.size) {
      if (droidStats)
        debug(`minicap.so version mismatch in ${this.client.serial} overwriting file.`)
      const tr = await this.client.push(soFile, '/data/local/tmp/minicap.so', 0o755);
      await tr.waitForEnd();
    }
    // await this.client.push(apkFile, '/data/local/tmp/minicap.apk', 0o755);
    // adb push libs/$ABI/minicap /data/local/tmp/

    const runnings = await this.client.getPs('-A');
    const minicapPs = runnings.filter(p => p.NAME === 'minicap');
    for (const ps of minicapPs) {
      debug(`killing old minicap process ${ps.PID}`);
      await this.client.execOut(`kill ${ps.PID}`);
    }

    const args = ['LD_LIBRARY_PATH=/data/local/tmp/', 'exec', '/data/local/tmp/minicap']
    {
      args.push('-P')
      if (!this.config.dimention) {
        const { x, y } = await ThirdUtils.getScreenSize(this.client);
        const dim = `${x}x${y}`;
        args.push(`${dim}@${dim}/0`);
      } else {
        args.push(this.config.dimention)
      }
    }
    this.minicapServer = new PromiseDuplex(await this.client.shell(args.map(a => a.toString()).join(' ')));
    this.minicapServer.once("finish").then(() => {
      this.stop(`minicap server finish`);
    })
    // minicap: PID: 14231
    // INFO: Using projection 1080x2376@1080x2376/0
    // INFO: (external/MY_minicap/src/minicap_30.cpp:243) Creating SurfaceComposerClient
    // INFO: (external/MY_minicap/src/minicap_30.cpp:246) Performing SurfaceComposerClient init check
    // INFO: (external/MY_minicap/src/minicap_30.cpp:257) Creating virtual display
    // INFO: (external/MY_minicap/src/minicap_30.cpp:263) Creating buffer queue
    // INFO: (external/MY_minicap/src/minicap_30.cpp:266) Setting buffer options
    // INFO: (external/MY_minicap/src/minicap_30.cpp:270) Creating CPU consumer
    // INFO: (external/MY_minicap/src/minicap_30.cpp:274) Creating frame waiter
    // INFO: (external/MY_minicap/src/minicap_30.cpp:278) Publishing virtual display
    // INFO: (jni/minicap/JpgEncoder.cpp:64) Allocating 7783428 bytes for JPG encoder
    // INFO: (jni/minicap/JpgEncoder.cpp:64) Allocating 3458052 bytes for JPG encoder
    await Utils.waitforText(this.minicapServer, /JpgEncoder/, 5000);
    // Connect videoSocket
    if (!this.closed) {
      try {
        this.videoSocket = await this.client.openLocal2('localabstract:minicap');
      } catch (e) {
        debug(`Impossible to connect video Socket localabstract:minicap`, e);
        throw e;
      }
      this.videoSocket.once('end').then(() => { this.stop('connection to localabstract:minicap ended') })
      // this.videoSocket.once('finish').then(() => { this.stop('connection to localabstract:minicap finished') })

      void this.startStream(this.videoSocket).catch((e) => this.stop(`stream throws ${e}`));
      // wait until first stream chunk is recieved
    }
    await this.bitflags;
    return this;
  }

  private async startStream(videoSocket: PromiseDuplex<Duplex>) {
    // first chunk 24
    try {
      await Utils.waitforReadable(videoSocket);
      let firstChunk = await videoSocket.read(2) as Buffer;
      if (!firstChunk) {
        throw Error('Fail to read firstChunk 2 byte Header.');
      }
      this.setVersion((firstChunk as unknown as Uint8Array)[0]); // == 1
      const len = (firstChunk as unknown as Uint8Array)[1]; // == 24
      firstChunk = await videoSocket.read(len - 2) as Buffer;
      if (!firstChunk) {
        throw Error('Fail to read firstChunk data.');
      }
      this.setPid(firstChunk.readUint32LE(0));
      this.setRealWidth(firstChunk.readUint32LE(4));
      this.setRealHigth(firstChunk.readUint32LE(8));
      this.setVirtualWidth(firstChunk.readUint32LE(12));
      this.setVirtualHigth(firstChunk.readUint32LE(16));
      this.setOrientation(firstChunk.readUint8(20));
      this.setBitflags(firstChunk.readUint8(21));
    } catch (e) {
      debug('Impossible to read first chunk:', e);
      throw e;
    }
    for (; ;) {
      if (this.closed)
        return;
      await Utils.waitforReadable(videoSocket);
      let chunk = videoSocket.stream.read(4) as Buffer;
      if (!chunk)
        continue;
      let len = chunk.readUint32LE(0);
      // len -= 4;
      let streamChunk: Buffer | null = null;
      while (streamChunk === null) {
        if (this.closed)
          return;
        await Utils.waitforReadable(videoSocket);
        chunk = videoSocket.stream.read(len) as Buffer;
        if (chunk) {
          len -= (chunk as unknown as Uint8Array).length;
          if (!streamChunk)
            streamChunk = chunk;
          else {
            streamChunk = Buffer.concat([streamChunk as Uint8Array, chunk as unknown as Uint8Array]);
          }
          if ((streamChunk as unknown as Uint8Array)[0] !== 0xFF || (streamChunk as unknown as Uint8Array)[1] !== 0xD8) {
            console.error('Frame body does not start with JPG header');
            return;
          }
        }
        if (len === 0) {
          if (this.setFirstFrame) {
            this.setFirstFrame();
            this.setFirstFrame = null;
          }
          if (streamChunk)
            this.emit('data', streamChunk);
          break;
        } else {
          await Utils.delay(0);
        }
      }
    }
  }

  /**
   * closed all socket and emit disconnect in if socket closed
   * @returns true if videoSocket or minicapServer get closed
   */
  public stop(cause?: string): boolean {
    this.closed = true;
    let close = false;
    if (this.videoSocket) {
      this.videoSocket.destroy();
      this.videoSocket = undefined;
      close = true;
    }
    if (this.minicapServer) {
      this.minicapServer.destroy();
      this.minicapServer = undefined;
      close = true;
    }
    if (close)
      this.emit('disconnect', cause || 'close() called');
    return close;
  }

  isRunning(): boolean {
    return this.videoSocket !== null;
  }
}
