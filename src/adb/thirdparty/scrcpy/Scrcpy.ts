import EventEmitter from 'node:events';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import assert from 'node:assert';

import PromiseDuplex from 'promise-duplex';
import DeviceClient from '../../DeviceClient.js';
import Utils from '../../utils.js';
import { Duplex } from 'node:stream';
import { type MotionEvent, MotionEventMap, OrientationMap, ControlMessageMap, codexMap } from './ScrcpyConst.js';
import { KeyCodes } from '../../keycode.js';
import { BufWrite } from '../minicap/BufWrite.js';
// import ThirdUtils from '../ThirdUtils.js';
import Stats from '../../sync/stats.js';
import { parse_sequence_parameter_set } from './sps.js';
import { Point, ScrcpyOptions, H264Configuration, VideoStreamFramePacket } from './ScrcpyModels.js';
import prebuilds from "@u4/minicap-prebuilt";

const SC_SOCKET_NAME_PREFIX = "scrcpy_";

const debug = Utils.debug('adb:scrcpy');

// const KEYFRAME_PTS = BigInt(1) << BigInt(62);
// from https://github.com/Genymobile/scrcpy/blob/master/server/src/main/java/com/genymobile/scrcpy/ScreenEncoder.java

const PACKET_FLAG_CONFIG = BigInt(1) << BigInt(63);
const PACKET_FLAG_KEY_FRAME = BigInt(1) << BigInt(62);

/**
 * usage reference fron app/src/server.c in scrcpy
 * https://github.com/Genymobile/scrcpy/blob/master/app/src/server.c
 */

/**
 * by hand start:
 * 
 * adb push scrcpy-server-v1.8.jar /data/local/tmp/scrcpy-server.jar
 * adb push scrcpy-server-v1.20.jar /data/local/tmp/scrcpy-server.jar
 * 
 * CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 600 1000 true 9999:9999:0:0 true 
 * 
 * adb forward tcp:8099 localabstract:scrcpy
 */

/**
 * enforce EventEmitter typing
 */
interface IEmissions {
  frame: (data: VideoStreamFramePacket) => void
  /**
   * since Scrcpy v2.0 an extra event is emitted with the codec, width and height
   */
  codec: (data: {codec: string, width: number, height: number}) => void
  config: (data: H264Configuration) => void
  raw: (data: Buffer) => void
  error: (error: Error) => void
  disconnect: () => void
}

/**
 * How scrcpy works?
 * 
 * Its a jar file that runs on an adb shell. It records the screen in h264 and offers it in a given tcp port.
 * 
 * scrcpy params
 *   maxSize         (integer, multiple of 8) 0
 *   bitRate         (integer)
 *   tunnelForward   (optional, bool) use "adb forward" instead of "adb tunnel"
 *   crop            (optional, string) "width:height:x:y"
 *   sendFrameMeta   (optional, bool) 
 * 
 * The video stream contains raw packets, without time information. If sendFrameMeta is enabled a meta header is added
 * before each packet.
 * The "meta" header length is 12 bytes
 * [. . . . . . . .|. . . .]. . . . . . . . . . . . . . . ...
 *  <-------------> <-----> <-----------------------------...
 *        PTS         size      raw packet (of size len)
 * 
 * WARNING:
 * Need USB Debug checked in developper option for MIUI
 */
export default class Scrcpy extends EventEmitter {
  private config: ScrcpyOptions;
  private videoSocket: PromiseDuplex<Duplex> | undefined;
  private audioSocket: PromiseDuplex<Duplex> | undefined;
  private controlSocket: PromiseDuplex<Duplex> | undefined;
  /**
   * used to recive Process Error
   */
  private scrcpyServer: PromiseDuplex<Duplex> | undefined;

  ///////
  // promise holders
  private _name: Promise<string>;
  private _codec: Promise<string>;
  private _width: Promise<number>;
  private _height: Promise<number>;
  private _onTermination: Promise<string>;
  private _firstFrame: Promise<void>;

  ////////
  // promise resolve calls

  private setCodec!: (name: string) => void;
  private setName!: (name: string) => void;
  private setWidth!: (width: number) => void;
  private setHeight!: (height: number) => void;
  private setFatalError?: (error: string) => void;
  private setFirstFrame?: (() => void) | null;

  private lastConf?: H264Configuration;
  /**
   * closed had been call stop all new activity
   */
  private closed = false;

  constructor(private client: DeviceClient, config = {} as Partial<ScrcpyOptions>) {
    super();
    this.config = {
      scid: '0' + Math.random().toString(16).substring(2, 9),
      noAudio: true, // disable audio TMP
      version: "2.7",
      // port: 8099,
      maxSize: 600,
      maxFps: 0,
      flip: false,
      bitrate: 999999999,
      lockedVideoOrientation: OrientationMap.LOCK_VIDEO_ORIENTATION_UNLOCKED,
      tunnelForward: true,
      tunnelDelay: 1000,
      crop: '', //'9999:9999:0:0',
      sendFrameMeta: true, // send PTS so that the client may record properly
      control: true,
      displayId: 0,
      showTouches: false,
      stayAwake: true,
      codecOptions: '',
      encoderName: '',
      powerOffScreenOnClose: false,
      // clipboardAutosync: true,
      ...config
    };
    this._name = new Promise<string>((resolve) => this.setName = resolve);
    this._width = new Promise<number>((resolve) => this.setWidth = resolve);
    this._height = new Promise<number>((resolve) => this.setHeight = resolve);
    this._codec = new Promise<string>((resolve) => this.setCodec = resolve);
    this._onTermination = new Promise<string>((resolve) => this.setFatalError = resolve);
    this._firstFrame = new Promise<void>((resolve) => this.setFirstFrame = resolve);

    let versionSplit = this.config.version.split(".").map(Number);
    if (versionSplit.length === 2) {
      versionSplit = [...versionSplit, 0];
    }
    this.major = versionSplit[0];
    this.minor = versionSplit[1];
    this.patch = versionSplit[2];
    this.strVersion = `${this.major.toString().padStart(2, '0')}.${this.minor.toString().padStart(2, '0')}.${this.patch.toString().padStart(2, '0')}`;
  }

  readonly strVersion: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  get name(): Promise<string> { return this._name; }
  get width(): Promise<number> { return this._width; }
  get height(): Promise<number> { return this._height; }

  /**
   * Clever way to detect Termination.
   * return the Ending message.
   */
  get onTermination(): Promise<string> { return this._onTermination; }

  /**
   * Promise to the first emited frame
   * can be used to unsure that scrcpy propery start
   */
  get firstFrame(): Promise<void> { return this._firstFrame; }

  /**
   * return the used codex can be "H264", "H265", "AV1", "AAC" or "OPUS"
   */
  get codec(): Promise<string> { return this._codec; }

  /**
   * emit scrcpyServer output as Error
   * @param duplex 
   * @returns 
   */
  async ListenErrors(duplex: PromiseDuplex<Duplex>) {
    try {
      const errors = [];
      for (; ;) {
        if (!duplex.readable) // the server is stoped
          break;
        await Utils.waitforReadable(duplex, 0, 'wait for error from ScrcpyServer');
        const data = await duplex.read();
        if (data) {
          const msg = data.toString().trim();
          errors.push(msg);
          try {
            this.emit('error', Error(msg));
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e: unknown) {
            // emit Error but to not want to Quit Yet
          }
        } else {
          if (errors.length > 0)
            this._setFatalError(errors.join('\n'));
          // else no error
          break;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e: unknown) {
      // must never throw
      //this.emit('error', e as Error);
      //this.setError((e as Error).message);
    }
  }

  private _setFatalError(msg: string | Error) {
    // console.error(`_setFatalError. Scrcpy fatal error:`, msg);
    if (this.setFatalError) {
      if (msg instanceof Error) {
        this.setFatalError(msg.message + '\n' + msg.stack);
      } else {
        this.setFatalError(msg);
      }
      this.setFatalError = undefined;
    }
  }

  /**
   * get last current video config
   */
  get videoConfig(): H264Configuration | undefined {
    return this.lastConf;
  }

  /**
   * Read a message from the contoler Duplex
   * 
   * @param duplex only supoport clipboard
   * @returns 
   */
  async readOneMessage(duplex: PromiseDuplex<Duplex>): Promise<string> {
    if (!duplex)
      return '';
    // const waitforReadable = () => new Promise<void>((resolve) => duplex.readable.stream.once('readable', resolve));
    await Utils.waitforReadable(duplex);
    let chunk = (await duplex.read(1)) as Buffer;
    const type = chunk.readUInt8();
    switch (type) {
      case 0: // clipboard
      {
        await Utils.waitforReadable(duplex);
        chunk = (await duplex.read(4)) as Buffer;
        await Utils.waitforReadable(duplex);
        const len = chunk.readUint32BE();
        await Utils.waitforReadable(duplex);
        chunk = (await duplex.read(len)) as Buffer;
        const text = chunk.toString('utf8');
        return text;
      }
      default:
        throw Error(`Unsupported message type:${type}`);
    }
  }

  private _getStartupLine(jarDest: string): string {
    const args: Array<string | number | boolean> = [];
    const {
      maxSize, bitrate, maxFps, lockedVideoOrientation, tunnelForward, crop,
      sendFrameMeta, control, displayId, showTouches, stayAwake, codecOptions,
      encoderName, powerOffScreenOnClose, clipboardAutosync
    } = this.config;
    args.push(`CLASSPATH=${jarDest}`);
    args.push('app_process');
    args.push('/');
    args.push('com.genymobile.scrcpy.Server');
    // first args is the expected version number
    if (this.strVersion === "02.02.00") {
      // V2.2 is the only version that expect a v prefix
      args.push("v" + this.config.version);
    } else {
      args.push(this.config.version);
    }
    // args.push(this.config.version); // arg 0 Scrcpy server version
    //if (this.config.version <= 20) {
    if (this.major < 2) {
      // Version 11 => 20
      args.push("info"); // Log level: info, verbose...
      args.push(maxSize); // Max screen width (long side)
      args.push(bitrate); // Bitrate of video
      args.push(maxFps); // Max frame per second
      args.push(lockedVideoOrientation); // Lock screen orientation: LOCK_SCREEN_ORIENTATION
      args.push(tunnelForward); // Tunnel forward
      args.push(crop || '-'); //    Crop screen
      args.push(sendFrameMeta); // Send frame rate to client
      args.push(control); //  Control enabled
      args.push(displayId); //     Display id
      args.push(showTouches); // Show touches
      args.push(stayAwake); //  if self.stay_awake else "false",  Stay awake
      args.push(codecOptions || '-'); //     Codec (video encoding) options
      args.push(encoderName || '-'); //     Encoder name
      args.push(powerOffScreenOnClose); // Power off screen after server closed
    } else {
      if (this.major >= 2) {
        args.push(`scid=${this.config.scid}`);
        if (this.config.noAudio)
          args.push(`audio=false`);
        // if (this.config.noControl)
        //   args.push(`no_control=${this.config.noControl}`);
      }

      if (this.strVersion >= "02.04.00") {
        args.push(`video_source=display`);
      }

      args.push("log_level=info");
      args.push(`max_size=${maxSize}`);
      args.push("clipboard_autosync=false"); // cause crash on some newer phone and we do not use that feature.
      if (this.major >= 2) {
        args.push(`video_bit_rate=${bitrate}`);
      } else {
        args.push(`bit_rate=${bitrate}`);
      }
      args.push(`max_fps=${maxFps}`);
      args.push(`lock_video_orientation=${lockedVideoOrientation}`);
      args.push(`tunnel_forward=${tunnelForward}`); // Tunnel forward
      if (crop && crop !== '-')
        args.push(`crop=${crop}`); //    Crop screen
      args.push(`send_frame_meta=${sendFrameMeta}`); // Send frame rate to client
      args.push(`control=${control}`); //  Control enabled
      args.push(`display_id=${displayId}`); //     Display id
      args.push(`show_touches=${showTouches}`); // Show touches
      args.push(`stay_awake=${stayAwake}`); //  if self.stay_awake else "false",  Stay awake
      if (codecOptions && codecOptions !== '-')
        args.push(`codec_options=${codecOptions}`); //     Codec (video encoding) options
      if (encoderName && encoderName !== '-')
        args.push(`encoder_name=${encoderName}`); //     Encoder name
      args.push(`power_off_on_close=${powerOffScreenOnClose}`); // Power off screen after server closed
      // args.push(`clipboard_autosync=${clipboardAutosync}`); // default is True
      if (clipboardAutosync !== undefined)
        args.push(`clipboard_autosync=${clipboardAutosync}`); // default is True
      //if (this.config.version >= 22) {
      if (this.strVersion >= "01.22.00") {
        const {
          downsizeOnError, sendDeviceMeta, sendDummyByte, rawVideoStream
        } = this.config;
        if (downsizeOnError !== undefined)
          args.push(`downsize_on_error=${downsizeOnError}`);
        if (sendDeviceMeta !== undefined)
          args.push(`send_device_meta=${sendDeviceMeta}`);
        if (sendDummyByte !== undefined)
          args.push(`send_dummy_byte=${sendDummyByte}`);
        if (rawVideoStream !== undefined)
          args.push(`raw_video_stream=${rawVideoStream}`);
      }
      if (this.strVersion >= "01.22.00") {
        const { cleanup } = this.config;
        if (cleanup !== undefined)
          args.push(`raw_video_stream=${cleanup}`);
      }
      // check Server.java
    }
    return args.map(a => a.toString()).join(' ');
  }

  /**
   * Will connect to the android device, send & run the server and return deviceName, width and height.
   * After that data will be offered as a 'data' event.
   */
  async start(): Promise<this> {
    if (this.closed) // can not start once stop called
      return this;

    let dstFolder = '/data/local/tmp';
    let dstFolderStat = await this.client.stat(dstFolder).catch((e) => {console.log(e); return null;});
    if (!dstFolderStat) {
      dstFolder = '/tmp';
      dstFolderStat = await this.client.stat(dstFolder).catch(() => null);    
    }
    if (!dstFolderStat) {
      throw Error("can not find a writable tmp dest folder in device");
    }
    const jarDest = `${dstFolder}/scrcpy-server-v${this.config.version}.jar`;
    // Transfer server jar to device...
    const jar = prebuilds.getScrcpyJar(this.config.version);

    const srcStat: fs.Stats | null = await fs.promises.stat(jar).catch(() => null);
    if (!srcStat)
      throw Error(`fail to get ressource ${jar}`);
    const dstStat: Stats | null = await this.client.stat(jarDest).catch(() => null);
    if (!dstStat || srcStat.size !== dstStat.size) {
      try {
        debug(`pushing scrcpy-server.jar to ${this.client.serial}`);
        const transfer = await this.client.push(jar, jarDest);
        await transfer.waitForEnd();
      } catch (e) {
        debug(`Impossible to transfer server scrcpy-server.jar to ${this.client.serial}`, e);
        throw e;
      }
    } else {
      debug(`scrcpy-server.jar already present in ${this.client.serial}, keep it`);
    }
    ///////
    // Build the commandline to start the server
    try {
      const cmdLine = this._getStartupLine(jarDest);

      // console.log("starting scrcpy server with cmdLine:");
      // console.log(cmdLine);
      // console.log("");

      if (this.closed) // can not start once stop called
        return this;
      const duplex = await this.client.shell(cmdLine);
      this.scrcpyServer = new PromiseDuplex(duplex);
      this.scrcpyServer.once("finish").then(() => {
        debug(`scrcpyServer finished on device ${this.client.serial}`);
        this.stop();
      });
      // debug only
      // extraUtils.dumpReadable(this.scrcpyServer, 'scrcpyServer');
    } catch (e) {
      debug('Impossible to run server:', e);
      throw e;
    }

    let stdoutContent = '';
    for (; ;) {
      if (!await Utils.waitforReadable(this.scrcpyServer, this.config.tunnelDelay, 'scrcpyServer stdout loading')) {
        // const msg = `First line should be '[server] // INFO: Device: Name (Version), reveived:\n\n${info}`
        if (!stdoutContent)
          stdoutContent = "no stdout content";
        const error = `Starting scrcpyServer failed, scrcpy stdout:${stdoutContent}`;
        this._setFatalError(error);
        this.stop();
        throw Error(error);
      }
      const srvOut = await this.scrcpyServer.read();
      stdoutContent += (srvOut) ? srvOut.toString() : '';
      // the server may crash within the first message
      const errorIndex = stdoutContent.indexOf("[server] ERROR:");
      if (errorIndex >= 0) {
        const error = stdoutContent.substring(errorIndex)
        this._setFatalError(error);
        this.stop();
        throw Error(error);
      }
      if (stdoutContent.includes('[server] INFO: Device: '))
        break;
      // console.log('stdoutContent:', stdoutContent);
    }

    this.ListenErrors(this.scrcpyServer).then(() => {}, () => {});

    // from V2.0 SC_SOCKET_NAME name can be change
    let SC_SOCKET_NAME = 'scrcpy';
    if (this.major >= 2) {
      SC_SOCKET_NAME = SC_SOCKET_NAME_PREFIX + this.config.scid;
      assert(this.config.scid.length == 8, `scid length should be 8`);
    }

    // Wait 1 sec to forward to work
    // await Util.delay(this.config.tunnelDelay);

    if (this.closed) // can not start once stop called
      return this;

    // Connect videoSocket
    await Utils.delay(100);
    this.videoSocket = await this.client.openLocal2(`localabstract:${SC_SOCKET_NAME}`, 'first connection to scrcpy for video');
    this.videoSocket.stream.on('error', (e) => {
      console.error('videoSocket error', e);
    });

    if (this.closed) {
      this.stop();
      return this;
    }

    if (this.major >= 2 && !this.config.noAudio) {
      // Connect audioSocket
      this.audioSocket = await this.client.openLocal2(`localabstract:${SC_SOCKET_NAME}`, 'first connection to scrcpy for audio');
      // Connect controlSocket
      if (this.closed) {
        this.stop();
        return this;
      }
    }
    
    this.controlSocket = await this.client.openLocal2(`localabstract:${SC_SOCKET_NAME}`, 'second connection to scrcpy for control');
    if (this.closed) {
      this.stop();
      return this;
    }
    // First chunk is 69 bytes length -> 1 dummy byte, 64 bytes for deviceName, 2 bytes for width & 2 bytes for height
    try {
      await Utils.waitforReadable(this.videoSocket, 0, 'videoSocket 1st 1 bit chunk');
      const firstChunk = await this.videoSocket.read(1) as Uint8Array;
      if (!firstChunk) {
        throw Error('fail to read firstChunk, inclease tunnelDelay for this device.');
      }

      // old protocol
      const control = firstChunk.at(0);
      if (firstChunk.at(0) !== 0) {
        if (control)
          throw Error(`Control code should be 0x00, receves: 0x${control.toString(16).padStart(2, '0')}`);
        throw Error(`Control code should be 0x00, receves nothing.`);
      }
    } catch (e) {
      debug('Impossible to read first chunk:', e);
      throw e;
    }

    if (this.config.sendFrameMeta) {
      void this.startStreamWithMeta().catch((e) => {
        this._setFatalError(e);
        this.stop();
      });
    } else {
      this.startStreamRaw();
    }
    // wait the first chunk
    await this.height;
    return this;
  }

  public stop(): boolean {
    this.closed = true;
    let close = false;
    if (this.videoSocket) {
      this.videoSocket.destroy();
      this.videoSocket = undefined;
      close = true;
    }
    if (this.audioSocket) {
      this.audioSocket.destroy();
      this.audioSocket = undefined;
      close = true;
    }
    if (this.controlSocket) {
      this.controlSocket.destroy();
      this.controlSocket = undefined;
      close = true;
    }
    if (this.scrcpyServer) this.scrcpyServer.destroy();
    if (close) {
      this.emit('disconnect');
      this._setFatalError('stoped');
    }
    return close;
  }

  isRunning(): boolean {
    return this.videoSocket !== null;
  }

  private startStreamRaw() {
    assert(this.videoSocket);
    this.videoSocket.stream.on('data', d => this.emit('raw', d));
  }

  /**
   * capture all video trafique in a loop
   * get resolve once capture stop
   */
  private async startStreamWithMeta(): Promise<void> {
    assert(this.videoSocket);
    this.videoSocket.stream.pause();
    await Utils.waitforReadable(this.videoSocket, 0, 'videoSocket header');
    if (this.major >= 2) {
      const chunk = this.videoSocket.stream.read(64) as Buffer;
      if (!chunk)
        throw Error('fail to read firstChunk, inclease tunnelDelay for this device.');
      const name = chunk.toString('utf8', 0, 64).trim();
      this.setName(name);
      // const width = chunk.readUint16BE(64);
      // this.setWidth(width);
      // const height = chunk.readUint16BE(66);
      // this.setHeight(height);
    } else {
      const chunk = this.videoSocket.stream.read(68) as Buffer;
      if (!chunk)
        throw Error('fail to read firstChunk, inclease tunnelDelay for this device.');
      const name = chunk.toString('utf8', 0, 64).trim();
      this.setName(name);
      const width = chunk.readUint16BE(64);
      this.setWidth(width);
      const height = chunk.readUint16BE(66);
      this.setHeight(height);
    }
 
    let codec = "H264";
    // let header: Uint8Array | undefined;
    if (this.major >= 2) {
      await Utils.waitforReadable(this.videoSocket, 0, 'videoSocket Codec header');
      const frameMeta = this.videoSocket.stream.read(12) as Buffer;
      const codecId = frameMeta.readUInt32BE(0);
      // Read width (4 bytes)
      const width = frameMeta.readUInt32BE(4);
      // Read height (4 bytes)
      const height = frameMeta.readUInt32BE(8);
      switch (codecId) {
        case codexMap.H264:
          codec = "H264";
          break;
        case codexMap.H265:
          codec = "H265";
          break;
        case codexMap.AV1:
          codec = "AV1";
          break;
        case codexMap.OPUS:
          codec = "OPUS";
          break;
        case codexMap.AAC:
          codec = "AAC";
          break;
        case codexMap.RAW:
          codec = "RAW";
          break;
        default:
          codec = "UNKNOWN";
      }
      this.setCodec(codec);
      this.setWidth(width);
      this.setHeight(height);

      this.emit("codec", {codec, width, height});
    }

    let pts = BigInt(0);// Buffer.alloc(0);
    for (; ;) {
      if (!this.videoSocket)
        break;
      await Utils.waitforReadable(this.videoSocket, 0, 'videoSocket packet size');
      let len: number | undefined = undefined;
      if (this.config.sendFrameMeta) {
        if (!this.videoSocket)
          break;
        const frameMeta = this.videoSocket.stream.read(12) as Buffer;
        if (!frameMeta) {
          // regular end condition
          return;
        }
        pts = frameMeta.readBigUint64BE();
        len = frameMeta.readUInt32BE(8);
        // debug(`\tHeader:PTS =`, pts);
        // debug(`\tHeader:len =`, len);
      }

      const config = !!(pts & PACKET_FLAG_CONFIG);

      let streamChunk: Uint8Array | null = null; // Buffer
      while (streamChunk === null) {
        if (!this.videoSocket) // the server is stoped
          break;
        if (!this.videoSocket.stream.readable) // the server is stoped
          break;
        await Utils.waitforReadable(this.videoSocket, 0, 'videoSocket streamChunk');
        streamChunk = this.videoSocket.stream.read(len) as Uint8Array;
        if (streamChunk) {
          // const chunk_Uint8Array = streamChunk as unknown as Uint8Array;
          if (config) { // non-media data packet len: 30 .. 33
            /**
             * is a config package pts have PACKET_FLAG_CONFIG flag
             */
            const sequenceParameterSet = parse_sequence_parameter_set(streamChunk, codec);
            const {
              profile_idc: profileIndex,
              constraint_set: constraintSet,
              level_idc: levelIndex,
              pic_width_in_mbs_minus1,
              pic_height_in_map_units_minus1,
              frame_mbs_only_flag,
              frame_crop_left_offset,
              frame_crop_right_offset,
              frame_crop_top_offset,
              frame_crop_bottom_offset,
            } = sequenceParameterSet;
            const encodedWidth = (pic_width_in_mbs_minus1 + 1) * 16;
            const encodedHeight = (pic_height_in_map_units_minus1 + 1) * (2 - frame_mbs_only_flag) * 16;
            const cropLeft = frame_crop_left_offset * 2;
            const cropRight = frame_crop_right_offset * 2;
            const cropTop = frame_crop_top_offset * 2;
            const cropBottom = frame_crop_bottom_offset * 2;
            const croppedWidth = encodedWidth - cropLeft - cropRight;
            const croppedHeight = encodedHeight - cropTop - cropBottom;

            const videoConf: H264Configuration = {
              profileIndex, constraintSet, levelIndex, encodedWidth, encodedHeight,
              cropLeft, cropRight, cropTop, cropBottom, croppedWidth, croppedHeight,
              data: streamChunk,
            };
            this.lastConf = videoConf;
            this.emit('config', videoConf);
          } else {
            /**
             * if pts have PACKET_FLAG_KEY_FRAME, this is a keyframe
             */
            const keyframe = !!(pts & PACKET_FLAG_KEY_FRAME);
            if (keyframe) {
              pts &= ~PACKET_FLAG_KEY_FRAME;
            }
            const frame = { keyframe, pts, data: streamChunk, config: this.lastConf };
            if (this.setFirstFrame) {
              this.setFirstFrame();
              this.setFirstFrame = undefined;
            }
            this.emit('frame', frame);
          }
        } else {
          // large chunk.
          // console.log('fail to streamChunk len:', len);
          await Utils.delay(0);
        }
      }
    }
  }

  // ControlMessages

  // TYPE_INJECT_KEYCODE
  /**
   * // will be convert in a android.view.KeyEvent
   * https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/view/KeyEvent.java
   * @param action 
   * @param keyCode 
   * @param repeatCount 
   * @param metaState  combinaison of KeyEventMeta
   */
  async injectKeycodeEvent(action: MotionEvent, keyCode: KeyCodes, repeatCount: number, metaState: number): Promise<void> {
    const chunk = new BufWrite(14);
    chunk.writeUint8(ControlMessageMap.TYPE_INJECT_KEYCODE);
    chunk.writeUint8(action);
    chunk.writeUint32BE(keyCode);
    chunk.writeUint32BE(repeatCount);
    chunk.writeUint32BE(metaState);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk.buffer);
  }

  // TYPE_INJECT_TEXT
  async injectText(text: string): Promise<void> {
    const chunk = new BufWrite(5);
    chunk.writeUint8(ControlMessageMap.TYPE_INJECT_TEXT);
    chunk.writeString(text);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk.buffer);
  }

  /**
   * android.view.MotionEvent;
   * https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/view/MotionEvent.java
   * @param action 
   * @param pointerId 
   * @param position 
   * @param screenSize 
   * @param pressure 
   * 
   * see parseInjectTouchEvent()
   */
  // usb.data_len == 28
  async injectTouchEvent(
    action: MotionEvent,
    pointerId: bigint,
    position: Point,
    screenSize: Point,
    pressure: number = MotionEventMap.ACTION_UP,
    actionButton: number = MotionEventMap.BUTTON_PRIMARY,
    buttons: number = MotionEventMap.BUTTON_PRIMARY
  ): Promise<boolean> {
    let size = 28;
    if (this.major >= 2) {
      size += 4;
    }
    const chunk = new BufWrite(size);
    chunk.writeUint8(ControlMessageMap.TYPE_INJECT_TOUCH_EVENT);
    chunk.writeUint8(action); // action readUnsignedByte

    if (pressure === undefined) {
      if (action == MotionEventMap.ACTION_UP)
        pressure = 0x0
      else if (action == MotionEventMap.ACTION_DOWN)
        pressure = 0xffff
      else
        pressure = 0xffff
    }
    // Writes a long to the underlying output stream as eight bytes, high byte first.
    chunk.writeBigUint64BE(pointerId); // long pointerId = dis.readLong();
    //  Position position = parsePosition();
    chunk.writeUint32BE(position.x | 0); //   int x = dis.readInt();
    chunk.writeUint32BE(position.y | 0); //   int y = dis.readInt();
    chunk.writeUint16BE(screenSize.x | 0); // int screenWidth = dis.readUnsignedShort();
    chunk.writeUint16BE(screenSize.y | 0); // int screenHeight = dis.readUnsignedShort();
    chunk.writeUint16BE(pressure); //  Binary.u16FixedPointToFloat(dis.readShort()); 

    if (this.major >= 2) {
      chunk.writeUint32BE(actionButton);   // New: specific button for this action
    }
    chunk.writeUint32BE(buttons);        // Old: just buttons state
    // chunk.writeUint32BE(MotionEventMap.BUTTON_PRIMARY); // int actionButton = dis.readInt();
    // if (this.major >= 2) {
    //   chunk.writeUint32BE(MotionEventMap.BUTTON_PRIMARY); // int buttons = dis.readInt();
    // }
    assert(this.controlSocket);
    try {
      await this.controlSocket.write(chunk.buffer);
      return true;
    } catch (e) {
      debug(`injectTouchEvent failed:`, e);
      return false;
      // if the device is not connected anymore, we can not write to the controlSocket
    }
    // console.log(chunk.buffer.toString('hex'))
  }

  async injectScrollEvent(position: Point, screenSize: Point, HScroll: number, VScroll: number): Promise<void> {
    const chunk = new BufWrite(20);
    chunk.writeUint8(ControlMessageMap.TYPE_INJECT_SCROLL_EVENT);
    // Writes a long to the underlying output stream as eight bytes, high byte first.
    chunk.writeUint32BE(position.x | 0);
    chunk.writeUint32BE(position.y | 0);
    chunk.writeUint16BE(screenSize.x | 0);
    chunk.writeUint16BE(screenSize.y | 0);
    chunk.writeUint16BE(HScroll);
    chunk.writeInt32BE(VScroll);
    chunk.writeInt32BE(MotionEventMap.BUTTON_PRIMARY);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk.buffer);
  }

  // TYPE_BACK_OR_SCREEN_ON
  async injectBackOrScreenOn(): Promise<void> {
    const chunk = new BufWrite(2);
    chunk.writeUint8(ControlMessageMap.TYPE_BACK_OR_SCREEN_ON);
    chunk.writeUint8(MotionEventMap.ACTION_UP);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk.buffer);
  }

  // TYPE_EXPAND_NOTIFICATION_PANEL
  async expandNotificationPanel(): Promise<void> {
    const chunk = Buffer.allocUnsafe(1);
    chunk.writeUInt8(ControlMessageMap.TYPE_EXPAND_NOTIFICATION_PANEL);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
  }

  // TYPE_COLLAPSE_PANELS
  async collapsePannels(): Promise<void> {
    const chunk = Buffer.allocUnsafe(1);
    chunk.writeUInt8(ControlMessageMap.TYPE_EXPAND_SETTINGS_PANEL);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
  }

  // TYPE_GET_CLIPBOARD
  async getClipboard(): Promise<string> {
    const chunk = Buffer.allocUnsafe(1);
    chunk.writeUInt8(ControlMessageMap.TYPE_GET_CLIPBOARD);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
    return this.readOneMessage(this.controlSocket);
  }

  // TYPE_SET_CLIPBOARD
  async setClipboard(text: string): Promise<void> {
    const chunk = new BufWrite(6);
    chunk.writeUint8(ControlMessageMap.TYPE_SET_CLIPBOARD);
    chunk.writeUint8(1); // past
    chunk.writeString(text)
    assert(this.controlSocket);
    await this.controlSocket.write(chunk.buffer);
  }

  // TYPE_SET_SCREEN_POWER_MODE
  async setScreenPowerMode(): Promise<void> {
    const chunk = Buffer.allocUnsafe(1);
    chunk.writeUInt8(ControlMessageMap.TYPE_SET_SCREEN_POWER_MODE);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
  }

  // TYPE_ROTATE_DEVICE
  async rotateDevice(): Promise<void> {
    const chunk = Buffer.allocUnsafe(1);
    chunk.writeUInt8(ControlMessageMap.TYPE_ROTATE_DEVICE);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
  }
}
