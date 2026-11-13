import EventEmitter from 'node:events';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import assert from 'node:assert';
import { execFile } from 'node:child_process';

import PromiseDuplex from 'promise-duplex';
import DeviceClient from '../../DeviceClient.js';
import Utils from '../../utils.js';
import path from 'node:path';
import { Duplex } from 'node:stream';
import { type MotionEvent, MotionEventMap, OrientationMap, ControlMessageMap, codexMap, type SurfaceControl, SurfaceControlMap } from './ScrcpyConst.js';
import { KeyCodes } from '../../keycode.js';
import { BufWrite } from '../minicap/BufWrite.js';
// import ThirdUtils from '../ThirdUtils.js';
import Stats from '../../sync/stats.js';
import { parse_sequence_parameter_set } from './sps.js';
import { Point, ScrcpyOptions, H264Configuration, VideoStreamFramePacket, VideoRecordOptions, VideoRecordResult } from './ScrcpyModels.js';
import prebuilds from "@u4/minicap-prebuilt";
import { downloadScrcpyServer, getDefaultScrcpyJarPath } from './ScrcpyDownload.js';

const SC_SOCKET_NAME_PREFIX = "scrcpy_";

const debug = Utils.debug('adb:scrcpy');

// const KEYFRAME_PTS = BigInt(1) << BigInt(62);
// from https://github.com/Genymobile/scrcpy/blob/master/server/src/main/java/com/genymobile/scrcpy/ScreenEncoder.java

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
  codec: (data: { codec: string, width: number, height: number }) => void
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
  static downloadServer = downloadScrcpyServer;
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

  private currentWidth = 0;
  private currentHeight = 0;

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
      version: "5.0.1",
      autoDownload: true,
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
    this._width = new Promise<number>((resolve) => this.setWidth = (w) => { this.currentWidth = w; resolve(w); });
    this._height = new Promise<number>((resolve) => this.setHeight = (h) => { this.currentHeight = h; resolve(h); });
    this._codec = new Promise<string>((resolve) => this.setCodec = resolve);
    this._onTermination = new Promise<string>((resolve) => this.setFatalError = resolve);
    this._firstFrame = new Promise<void>((resolve) => this.setFirstFrame = resolve);

    const rawVersion = this.config.version.replace(/^v/i, '');
    const versionParts = rawVersion.split('.').map((part) => {
      const n = Number(part);
      return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
    });
    this.major = versionParts[0] ?? 0;
    this.minor = versionParts[1] ?? 0;
    this.patch = versionParts[2] ?? 0;
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
          } catch (_e: unknown) {
            // emit Error but to not want to Quit Yet
          }
        } else {
          if (errors.length > 0)
            this._setFatalError(errors.join('\n'));
          // else no error
          break;
        }
      }
    } catch (_e: unknown) {
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

  public getStartupLine(jarDest = '/data/local/tmp/scrcpy-server.jar'): string {
    return this._getStartupLine(jarDest);
  }

  private static shellEscapeArg(arg: string | number | boolean): string {
    const s = arg.toString();
    if (s.length === 0) {
      return "''";
    }
    if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(s)) {
      return s;
    }
    return `'${s.replace(/'/g, "'\"'\"'")}'`;
  }

  private _getStartupLine(jarDest: string): string {
    const args: Array<string | number | boolean> = [];
    const {
      maxSize, bitrate, maxFps, lockedVideoOrientation, tunnelForward, crop,
      sendFrameMeta, control, displayId, showTouches, stayAwake, codecOptions,
      encoderName, powerOffScreenOnClose, clipboardAutosync,
      captureOrientation, angle, newDisplay, vdSystemDecorations, vdDestroyContent,
      displayImePolicy, audioSource, screenOffTimeout,
      flexDisplay, keepActive, minSizeAlignment, cameraZoom, cameraTorch,
      ignoreVideoEncoderConstraints, videoCodec
    } = this.config;
    const envAssignment = `CLASSPATH=${Scrcpy.shellEscapeArg(jarDest)}`;
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
    if (this.major < 2) {
      // Version 1.x
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
      args.push(`scid=${this.config.scid}`);
      if (this.config.noAudio) {
        args.push(`audio=false`);
      } else if (audioSource) {
        args.push(`audio_source=${audioSource}`);
      }

      if (this.strVersion >= "02.04.00") {
        args.push(`video_source=display`);
      }

      if (videoCodec) {
        args.push(`video_codec=${videoCodec}`);
      }

      args.push("log_level=info");
      args.push(`max_size=${maxSize}`);
      args.push("clipboard_autosync=false"); // cause crash on some newer phone and we do not use that feature.
      args.push(`video_bit_rate=${bitrate}`);
      args.push(`max_fps=${maxFps}`);

      if (this.major >= 3) {
        // In scrcpy 3.0+, lock_video_orientation was replaced by capture_orientation and angle
        if (captureOrientation) {
          args.push(`capture_orientation=${captureOrientation}`);
        } else if (lockedVideoOrientation !== OrientationMap.LOCK_VIDEO_ORIENTATION_UNLOCKED) {
          if (lockedVideoOrientation === OrientationMap.LOCK_VIDEO_ORIENTATION_INITIAL) {
            args.push(`capture_orientation=@`);
          } else if (lockedVideoOrientation === OrientationMap.LOCK_SCREEN_ORIENTATION_0) {
            args.push(`capture_orientation=@0`);
          } else if (lockedVideoOrientation === OrientationMap.LOCK_SCREEN_ORIENTATION_1) {
            args.push(`capture_orientation=@90`);
          } else if (lockedVideoOrientation === OrientationMap.LOCK_SCREEN_ORIENTATION_2) {
            args.push(`capture_orientation=@180`);
          } else if (lockedVideoOrientation === OrientationMap.LOCK_SCREEN_ORIENTATION_3) {
            args.push(`capture_orientation=@270`);
          }
        }
        if (angle !== undefined) {
          args.push(`angle=${angle}`);
        }
        if (newDisplay) {
          args.push(`new_display=${newDisplay}`);
        }
        if (vdSystemDecorations !== undefined) {
          args.push(`vd_system_decorations=${vdSystemDecorations}`);
        }
        if (this.strVersion >= "03.01.00" && vdDestroyContent !== undefined) {
          args.push(`vd_destroy_content=${vdDestroyContent}`);
        }
        if (this.strVersion >= "03.02.00" && displayImePolicy) {
          args.push(`display_ime_policy=${displayImePolicy}`);
        }
        if (screenOffTimeout !== undefined) {
          args.push(`screen_off_timeout=${screenOffTimeout}`);
        }
        if (this.major >= 4) {
          if (flexDisplay !== undefined) {
            args.push(`flex_display=${flexDisplay}`);
          }
          if (keepActive !== undefined) {
            args.push(`keep_active=${keepActive}`);
          }
          if (minSizeAlignment !== undefined) {
            args.push(`min_size_alignment=${minSizeAlignment}`);
          }
          if (cameraZoom !== undefined) {
            args.push(`camera_zoom=${cameraZoom}`);
          }
          if (cameraTorch !== undefined) {
            args.push(`camera_torch=${cameraTorch}`);
          }
          if (this.strVersion >= "04.01.00" && ignoreVideoEncoderConstraints !== undefined) {
            args.push(`ignore_video_encoder_constraints=${ignoreVideoEncoderConstraints}`);
          }
        }
      } else {
        args.push(`lock_video_orientation=${lockedVideoOrientation}`);
      }

      args.push(`tunnel_forward=${tunnelForward}`); // Tunnel forward
      if (crop && crop !== '-')
        args.push(`crop=${crop}`); //    Crop screen
      args.push(`send_frame_meta=${sendFrameMeta}`); // Send frame rate to client
      args.push(`control=${control}`); //  Control enabled
      args.push(`display_id=${displayId}`); //     Display id
      args.push(`show_touches=${showTouches}`); // Show touches
      args.push(`stay_awake=${stayAwake}`); //  if self.stay_awake else "false",  Stay awake
      if (codecOptions && codecOptions !== '-')
        args.push(`video_codec_options=${codecOptions}`); //     Codec (video encoding) options
      if (encoderName && encoderName !== '-')
        args.push(`video_encoder=${encoderName}`); //     Encoder name
      args.push(`power_off_on_close=${powerOffScreenOnClose}`); // Power off screen after server closed
      if (clipboardAutosync !== undefined)
        args.push(`clipboard_autosync=${clipboardAutosync}`); // default is True
      const {
        downsizeOnError, sendDeviceMeta, sendDummyByte, rawVideoStream, cleanup
      } = this.config;
      if (downsizeOnError !== undefined)
        args.push(`downsize_on_error=${downsizeOnError}`);
      if (sendDeviceMeta !== undefined)
        args.push(`send_device_meta=${sendDeviceMeta}`);
      if (sendDummyByte !== undefined)
        args.push(`send_dummy_byte=${sendDummyByte}`);
      if (rawVideoStream !== undefined)
        args.push(`raw_video_stream=${rawVideoStream}`);
      if (cleanup !== undefined)
        args.push(`cleanup=${cleanup}`);
    }
    return `${envAssignment} ${args.map(Scrcpy.shellEscapeArg).join(' ')}`;
  }

  /**
   * Will connect to the android device, send & run the server and return deviceName, width and height.
   * After that data will be offered as a 'data' event.
   */
  async start(): Promise<this> {
    if (this.closed) // can not start once stop called
      return this;

    // Check if directory exists on the device; ignore ENOENT but rethrow connection/transport errors
    const checkDir = async (path: string): Promise<Stats | null> => {
      try {
        return await this.client.stat(path);
      } catch (err: unknown) {
        const errnoErr = err as { code?: string; message?: string } | null;
        if (errnoErr?.code === 'ENOENT' || /no such file/i.test(errnoErr?.message || '')) {
          return null;
        }
        throw err;
      }
    };

    let dstFolder = '/data/local/tmp';
    let dstFolderStat = await checkDir(dstFolder);
    if (!dstFolderStat) {
      dstFolder = '/tmp';
      dstFolderStat = await checkDir(dstFolder);
    }
    if (!dstFolderStat) {
      throw Error("can not find a writable tmp dest folder in device");
    }
    const jarDest = `${dstFolder}/scrcpy-server-v${this.config.version}.jar`;
    // Transfer server jar to device...
    let jar = this.config.jarPath;
    let srcStat: fs.Stats | null = null;
    if (jar) {
      srcStat = await fs.promises.stat(jar).catch(() => null);
    }
    if (!srcStat) {
      try {
        const prebuildJar = prebuilds.getScrcpyJar(this.config.version);
        srcStat = await fs.promises.stat(prebuildJar).catch(() => null);
        if (srcStat) {
          jar = prebuildJar;
        }
      } catch {
        // ignore
      }
    }
    if (!srcStat) {
      const candidates = [
        getDefaultScrcpyJarPath(this.config.version),
        path.resolve(process.cwd(), 'prebuilt', 'scrcpy', `scrcpy-server-v${this.config.version}.jar`),
        path.resolve(process.cwd(), 'vendor', 'scrcpy', `scrcpy-server-v${this.config.version}.jar`),
      ];
      for (const candidate of candidates) {
        srcStat = await fs.promises.stat(candidate).catch(() => null);
        if (srcStat) {
          jar = candidate;
          break;
        }
      }
    }
    if (!srcStat && this.config.autoDownload !== false) {
      debug(`scrcpy-server-v${this.config.version}.jar not found locally, downloading...`);
      try {
        const downloadedPath = await downloadScrcpyServer(this.config.version);
        srcStat = await fs.promises.stat(downloadedPath).catch(() => null);
        if (srcStat) {
          jar = downloadedPath;
        }
      } catch (dlErr) {
        debug(`Failed to auto-download scrcpy-server v${this.config.version}:`, dlErr);
      }
    }
    if (!srcStat || !jar) {
      throw Error(`fail to get ressource scrcpy-server-v${this.config.version}.jar. Try running: npm run download:scrcpy ${this.config.version}`);
    }
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
      this.scrcpyServer.stream.once('close', () => {
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

    this.ListenErrors(this.scrcpyServer).then(() => { }, () => { });

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

    // Connect videoSocket with retry in case server socket is not immediately ready
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await Utils.delay(attempt === 0 ? 150 : 250);
        this.videoSocket = await this.client.openLocal2(`localabstract:${SC_SOCKET_NAME}`, 'first connection to scrcpy for video');
        break;
      } catch (err) {
        if (attempt === 4 || this.closed) {
          throw err;
        }
      }
    }
    if (!this.videoSocket) {
      throw Error('fail to connect videoSocket');
    }
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
      let streamError: unknown;
      void this.startStreamWithMeta().catch((e) => {
        streamError = e;
        this._setFatalError(e);
        this.stop();
      });
      // wait for the first metadata header (height) or stream termination/error
      await Promise.race([
        this.height,
        this._onTermination.then((msg) => {
          if (streamError instanceof Error) {
            throw streamError;
          }
          throw new Error(`Scrcpy terminated before receiving stream metadata: ${msg}`);
        }),
      ]);
    } else {
      this.startStreamRaw();
    }
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
    return !!this.videoSocket;
  }

  private startStreamRaw() {
    assert(this.videoSocket);
    this.videoSocket.stream.on('data', d => this.emit('raw', d));
  }

  private mapCodec(codecId: number): string {
    switch (codecId) {
      case codexMap.H264:
        return "H264";
      case codexMap.H265:
        return "H265";
      case codexMap.AV1:
        return "AV1";
      case codexMap.VP8:
        return "VP8";
      case codexMap.VP9:
        return "VP9";
      case codexMap.OPUS:
        return "OPUS";
      case codexMap.AAC:
        return "AAC";
      case codexMap.RAW:
        return "RAW";
      default:
        return "UNKNOWN";
    }
  }

  private async readExact(socket: PromiseDuplex<Duplex>, size: number, ctxt = ''): Promise<Buffer | null> {
    while (socket && socket.stream && socket.stream.readable) {
      const chunk = socket.stream.read(size) as Buffer | null;
      if (chunk) {
        return chunk;
      }
      await Utils.waitforReadable(socket, 0, ctxt);
    }
    return null;
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
      const chunk = await this.readExact(this.videoSocket, 64, 'videoSocket header');
      if (!chunk)
        throw Error('fail to read firstChunk, inclease tunnelDelay for this device.');
      const name = chunk.toString('utf8', 0, 64).replace(/\0/g, '').trim();
      this.setName(name);
    } else {
      const chunk = await this.readExact(this.videoSocket, 68, 'videoSocket header');
      if (!chunk)
        throw Error('fail to read firstChunk, inclease tunnelDelay for this device.');
      const name = chunk.toString('utf8', 0, 64).replace(/\0/g, '').trim();
      this.setName(name);
      const width = chunk.readUint16BE(64);
      this.setWidth(width);
      const height = chunk.readUint16BE(66);
      this.setHeight(height);
    }

    let codec = "H264";
    if (this.major >= 4) {
      // In scrcpy 4.0+:
      // 1. writeVideoHeader() sends only 4 bytes: codecId
      // 2. Initial writeSessionMeta() sends 12 bytes: flags (bit 31 = 1), width (4 bytes), height (4 bytes)
      const codecChunk = await this.readExact(this.videoSocket, 4, 'videoSocket Codec header');
      if (!codecChunk)
        throw Error('fail to read videoSocket Codec header');
      const codecId = codecChunk.readUInt32BE(0);
      codec = this.mapCodec(codecId);
      this.setCodec(codec);

      const sessionChunk = await this.readExact(this.videoSocket, 12, 'videoSocket Session header');
      if (!sessionChunk)
        throw Error('fail to read videoSocket Session header');
      const width = sessionChunk.readUInt32BE(4);
      const height = sessionChunk.readUInt32BE(8);
      this.setWidth(width);
      this.setHeight(height);
      this.emit("codec", { codec, width, height });
    } else if (this.major >= 2) {
      // In scrcpy 2.x and 3.x:
      // writeVideoHeader(videoSize) sends 12 bytes: codecId (4 bytes), width (4 bytes), height (4 bytes)
      const frameMeta = await this.readExact(this.videoSocket, 12, 'videoSocket Codec header');
      if (!frameMeta)
        throw Error('fail to read videoSocket Codec header');
      const codecId = frameMeta.readUInt32BE(0);
      const width = frameMeta.readUInt32BE(4);
      const height = frameMeta.readUInt32BE(8);
      codec = this.mapCodec(codecId);
      this.setCodec(codec);
      this.setWidth(width);
      this.setHeight(height);
      this.emit("codec", { codec, width, height });
    }

    const flagConfig = this.major >= 4 ? (BigInt(1) << BigInt(62)) : (BigInt(1) << BigInt(63));
    const flagKeyFrame = this.major >= 4 ? (BigInt(1) << BigInt(61)) : (BigInt(1) << BigInt(62));

    let pts = BigInt(0);// Buffer.alloc(0);
    for (; ;) {
      if (!this.videoSocket)
        break;
      let len: number | undefined = undefined;
      if (this.config.sendFrameMeta) {
        if (!this.videoSocket)
          break;
        const frameMeta = await this.readExact(this.videoSocket, 12, 'videoSocket packet size');
        if (!frameMeta) {
          // regular end condition
          return;
        }

        // In scrcpy 4.0, a 12-byte header with bit 63 set is a session packet (no payload data follows)
        if (this.major >= 4 && (frameMeta[0] & 0x80) !== 0) {
          const newWidth = frameMeta.readUInt32BE(4);
          const newHeight = frameMeta.readUInt32BE(8);
          this.setWidth(newWidth);
          this.setHeight(newHeight);
          this.emit("codec", { codec, width: newWidth, height: newHeight });
          continue;
        }

        pts = frameMeta.readBigUint64BE();
        len = frameMeta.readUInt32BE(8);
        // debug(`\tHeader:PTS =`, pts);
        // debug(`\tHeader:len =`, len);
      }

      const config = !!(pts & flagConfig);

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
            let videoConf: H264Configuration;
            try {
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

              videoConf = {
                profileIndex, constraintSet, levelIndex, encodedWidth, encodedHeight,
                cropLeft, cropRight, cropTop, cropBottom, croppedWidth, croppedHeight,
                data: streamChunk,
              };
            } catch {
              // For non-H264 codecs (e.g. H265, AV1) or unparsed SPS, store data as config
              videoConf = {
                profileIndex: 0, constraintSet: 0, levelIndex: 0,
                encodedWidth: this.currentWidth, encodedHeight: this.currentHeight,
                cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
                croppedWidth: this.currentWidth, croppedHeight: this.currentHeight,
                data: streamChunk,
              };
            }
            this.lastConf = videoConf;
            this.emit('config', videoConf);
          } else {
            /**
             * if pts have PACKET_FLAG_KEY_FRAME, this is a keyframe
             */
            const keyframe = !!(pts & flagKeyFrame);
            if (keyframe) {
              pts &= ~flagKeyFrame;
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
  async collapsePanels(): Promise<void> {
    const chunk = Buffer.allocUnsafe(1);
    chunk.writeUInt8(ControlMessageMap.TYPE_COLLAPSE_PANELS);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
  }

  /** @deprecated Use {@link collapsePanels} instead. */
  async collapsePannels(): Promise<void> {
    return this.collapsePanels();
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

  // TYPE_SET_SCREEN_POWER_MODE / TYPE_SET_DISPLAY_POWER
  async setScreenPowerMode(mode: SurfaceControl | boolean = SurfaceControlMap.POWER_MODE_NORMAL): Promise<void> {
    const chunk = Buffer.allocUnsafe(2);
    chunk.writeUInt8(ControlMessageMap.TYPE_SET_SCREEN_POWER_MODE, 0);
    if (this.major >= 3) {
      // In scrcpy 3.0, it is boolean on/off
      const on = typeof mode === 'boolean' ? mode : mode === SurfaceControlMap.POWER_MODE_NORMAL;
      chunk.writeUInt8(on ? 1 : 0, 1);
    } else {
      // In scrcpy 2.x and earlier, it is SurfaceControl power mode byte
      const rawMode = typeof mode === 'boolean'
        ? (mode ? SurfaceControlMap.POWER_MODE_NORMAL : SurfaceControlMap.POWER_MODE_OFF)
        : mode;
      chunk.writeUInt8(rawMode, 1);
    }
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
  }

  // TYPE_START_APP (since scrcpy 3.0)
  async startApp(packageName: string): Promise<void> {
    const chunk = new BufWrite(5);
    chunk.writeUint8(ControlMessageMap.TYPE_START_APP);
    chunk.writeString(packageName);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk.buffer);
  }

  // TYPE_RESET_VIDEO (since scrcpy 3.0)
  async resetVideo(): Promise<void> {
    const chunk = Buffer.allocUnsafe(1);
    chunk.writeUInt8(ControlMessageMap.TYPE_RESET_VIDEO);
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

  // TYPE_CAMERA_SET_TORCH (since scrcpy 4.0)
  async setCameraTorch(on: boolean): Promise<void> {
    const chunk = Buffer.allocUnsafe(2);
    chunk.writeUInt8(ControlMessageMap.TYPE_CAMERA_SET_TORCH, 0);
    chunk.writeUInt8(on ? 1 : 0, 1);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
  }

  // TYPE_CAMERA_ZOOM_IN (since scrcpy 4.0)
  async cameraZoomIn(): Promise<void> {
    const chunk = Buffer.allocUnsafe(1);
    chunk.writeUInt8(ControlMessageMap.TYPE_CAMERA_ZOOM_IN);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
  }

  // TYPE_CAMERA_ZOOM_OUT (since scrcpy 4.0)
  async cameraZoomOut(): Promise<void> {
    const chunk = Buffer.allocUnsafe(1);
    chunk.writeUInt8(ControlMessageMap.TYPE_CAMERA_ZOOM_OUT);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
  }

  // TYPE_RESIZE_DISPLAY (since scrcpy 4.0)
  async resizeDisplay(width: number, height: number): Promise<void> {
    const chunk = Buffer.allocUnsafe(5);
    chunk.writeUInt8(ControlMessageMap.TYPE_RESIZE_DISPLAY, 0);
    chunk.writeUInt16BE(width, 1);
    chunk.writeUInt16BE(height, 3);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk);
  }

  // TYPE_SCAN_FILE (since scrcpy 4.1)
  async scanFile(path: string): Promise<void> {
    const chunk = new BufWrite(5);
    chunk.writeUint8(ControlMessageMap.TYPE_SCAN_FILE);
    chunk.writeString(path);
    assert(this.controlSocket);
    await this.controlSocket.write(chunk.buffer);
  }

  /**
   * Record screen video directly to a file using Scrcpy.
   * If the destination path ends in .mp4 (or remuxMp4 is true), it writes the raw stream
   * and then automatically remuxes it into a browser-friendly MP4 container (via ffmpeg).
   *
   * @param destPath Destination file path (.mp4, .h264, .h265, etc.)
   * @param options Recording options (durationMs, maxFrames, remuxMp4, signal, onProgress)
   */
  async recordToFile(destPath: string, options: VideoRecordOptions = {}): Promise<VideoRecordResult> {
    const isMp4 = destPath.toLowerCase().endsWith('.mp4');
    const shouldRemux = options.remuxMp4 ?? isMp4;
    const resolvedPath = path.resolve(destPath);
    const destDir = path.dirname(resolvedPath);
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }

    let defaultExt = 'h264';
    if (this.config.videoCodec) {
      const vc = this.config.videoCodec.toLowerCase();
      if (vc.includes('265') || vc.includes('hevc')) defaultExt = 'h265';
      else if (vc.includes('av1')) defaultExt = 'av1';
    }

    const rawPath = shouldRemux && isMp4
      ? resolvedPath.replace(/\.mp4$/i, `.${defaultExt}`)
      : resolvedPath;

    const fileStream = fs.createWriteStream(rawPath);

    let frameCount = 0;
    let keyframeCount = 0;
    let totalBytes = 0;
    const startTime = Date.now();

    let stopTimer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    let streamError: Error | null = null;
    let isBackpressured = false;

    const stopRecording = () => {
      try {
        this.stop();
      } catch {
        // ignore
      }
    };

    const onStreamError = (err: Error) => {
      if (!streamError) {
        streamError = err;
      }
      stopRecording();
    };

    const onDrain = () => {
      if (isBackpressured) {
        isBackpressured = false;
        this.videoSocket?.stream.resume();
      }
    };

    const writeToFile = (data: Uint8Array) => {
      if (streamError || fileStream.destroyed || fileStream.writableEnded) {
        return;
      }
      const ok = fileStream.write(Buffer.from(data));
      if (!ok && !isBackpressured) {
        isBackpressured = true;
        this.videoSocket?.stream.pause();
      }
    };

    fileStream.on('error', onStreamError);
    fileStream.on('drain', onDrain);

    if (options.durationMs && options.durationMs > 0) {
      stopTimer = setTimeout(stopRecording, options.durationMs);
    }

    if (options.signal) {
      abortListener = () => stopRecording();
      if (options.signal.aborted) {
        stopRecording();
      } else {
        options.signal.addEventListener('abort', abortListener, { once: true });
      }
    }

    const onConfig = (conf: H264Configuration) => {
      if (conf && conf.data && conf.data.length > 0) {
        writeToFile(conf.data);
        totalBytes += conf.data.length;
      }
    };

    const onFrame = (packet: VideoStreamFramePacket) => {
      if (packet && packet.data && packet.data.length > 0) {
        frameCount++;
        if (packet.keyframe) keyframeCount++;
        totalBytes += packet.data.length;
        writeToFile(packet.data);

        if (options.onProgress) {
          options.onProgress({
            frames: frameCount,
            keyframes: keyframeCount,
            bytes: totalBytes,
            elapsedMs: Date.now() - startTime,
          });
        }

        if (options.maxFrames && frameCount >= options.maxFrames) {
          stopRecording();
        }
      }
    };

    this.on('config', onConfig);
    this.on('frame', onFrame);

    let trySucceeded = false;
    try {
      if (streamError) {
        throw streamError;
      }
      await this.start();
      await this.onTermination;
      trySucceeded = true;
    } finally {
      if (stopTimer) clearTimeout(stopTimer);
      if (options.signal && abortListener) {
        options.signal.removeEventListener('abort', abortListener);
      }
      this.off('config', onConfig);
      this.off('frame', onFrame);
      stopRecording();
      fileStream.off('drain', onDrain);
      fileStream.off('error', onStreamError);
      if (!fileStream.destroyed && !fileStream.writableEnded) {
        await new Promise<void>((resolve) => {
          const onEndErr = (err: Error) => {
            fileStream.off('finish', onFinish);
            if (!streamError) streamError = err;
            resolve();
          };
          const onFinish = () => {
            fileStream.off('error', onEndErr);
            resolve();
          };
          fileStream.once('error', onEndErr);
          fileStream.once('finish', onFinish);
          fileStream.end();
        });
      }
    }
    if (trySucceeded && streamError) {
      throw streamError;
    }

    const durationMs = Date.now() - startTime;
    let detectedCodec = 'H264';
    try {
      detectedCodec = await Promise.race([
        this.codec,
        Utils.delay(50).then(() => (this.config.videoCodec ? this.config.videoCodec.toUpperCase() : 'H264')),
      ]);
    } catch {
      // ignore
    }

    let finalWidth = 0;
    let finalHeight = 0;
    try {
      finalWidth = await Promise.race([this.width, Utils.delay(50).then(() => this.currentWidth)]);
      finalHeight = await Promise.race([this.height, Utils.delay(50).then(() => this.currentHeight)]);
    } catch {
      // ignore
    }

    let finalFilePath = rawPath;
    let remuxError: string | undefined;

    // Remux to MP4 container if requested
    if (shouldRemux) {
      const mp4Target = isMp4 ? resolvedPath : resolvedPath.replace(/\.[^.]+$/, '.mp4');
      const fps = options.framerate || this.config.maxFps || 30;
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(
            'ffmpeg',
            ['-y', '-r', fps.toString(), '-i', rawPath, '-c', 'copy', '-movflags', '+faststart', mp4Target],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        finalFilePath = mp4Target;
        // If the original requested destPath was .mp4, remove the intermediate raw file
        if (isMp4 && rawPath !== mp4Target && fs.existsSync(mp4Target)) {
          try {
            await fs.promises.unlink(rawPath);
          } catch {
            // ignore
          }
        }
      } catch (remuxErr) {
        remuxError = remuxErr instanceof Error ? remuxErr.message : String(remuxErr);
        debug('Remuxing to MP4 failed, keeping raw stream file:', remuxErr);
      }
    }

    return {
      filePath: finalFilePath,
      rawFilePath: finalFilePath !== rawPath ? rawPath : undefined,
      remuxError,
      frames: frameCount,
      keyframes: keyframeCount,
      bytes: totalBytes,
      codec: detectedCodec,
      width: finalWidth,
      height: finalHeight,
      durationMs,
    };
  }

  /**
   * List available video encoders reported by the device for scrcpy.
   *
   * @param deviceClient DeviceClient instance
   * @param scrcpyVersion Scrcpy server version (default: '3.0')
   */
  static async listEncoders(deviceClient: DeviceClient, scrcpyVersion: ScrcpyOptions['version'] = '3.0'): Promise<string[]> {
    const scrcpy = new Scrcpy(deviceClient, {
      version: scrcpyVersion,
      encoderName: '_', // intentionally invalid to trigger encoder listing
    });
    // Suppress error events
    scrcpy.on('error', () => {});
    try {
      await scrcpy.start();
    } catch {
      // Expected
    }
    const terminationOutput = await scrcpy.onTermination.catch(() => '');
    const encoders = [...terminationOutput.matchAll(/encoder '([^']+)'/g)].map((m) => m[1]);
    return Array.from(new Set(encoders));
  }
}
