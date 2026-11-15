import EventEmitter from 'node:events';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import assert from 'node:assert';
import path from 'node:path';
import { Duplex } from 'node:stream';

import PromiseDuplex from 'promise-duplex';
import prebuilds from '@u4/minicap-prebuilt';
import DeviceClient from '../../DeviceClient.js';
import Utils from '../../utils.js';
import { KeyCodes } from '../../keycode.js';
import Stats from '../../sync/stats.js';
import {
  type MotionEvent,
  MotionEventMap,
  OrientationMap,
  ControlMessageMap,
  type SurfaceControl,
  SurfaceControlMap,
} from './ScrcpyConst.js';
import { Point, ScrcpyOptions, H264Configuration, VideoStreamFramePacket, VideoRecordOptions, VideoRecordResult } from './ScrcpyModels.js';
import { downloadScrcpyServer, getDefaultScrcpyJarPath } from './ScrcpyDownload.js';
import { buildScrcpyStartupLine, parseScrcpyVersionParts } from './ScrcpyStartupArgs.js';
import { readDeviceMessage, readScrcpyVideoStream } from './ScrcpyProtocol.js';
import {
  buildBackOrScreenOnMessage,
  buildKeycodeMessage,
  buildResizeDisplayMessage,
  buildScrollEventMessage,
  buildSetCameraTorchMessage,
  buildSetClipboardMessage,
  buildSetScreenPowerModeMessage,
  buildSimpleControlMessage,
  buildStringControlMessage,
  buildTouchEventMessage,
} from './ScrcpyControlWriter.js';
import { recordScrcpyToFile, type ScrcpyRecorderHost } from './ScrcpyRecorder.js';

const SC_SOCKET_NAME_PREFIX = 'scrcpy_';

const debug = Utils.debug('adb:scrcpy');

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

  private _name: Promise<string>;
  private _codec: Promise<string>;
  private _width: Promise<number>;
  private _height: Promise<number>;
  private _onTermination: Promise<string>;
  private _firstFrame: Promise<void>;

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

  readonly strVersion: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;

  constructor(private client: DeviceClient, config = {} as Partial<ScrcpyOptions>) {
    super();
    this.config = {
      scid: '0' + Math.random().toString(16).substring(2, 9),
      noAudio: true, // disable audio TMP
      version: '5.0.1',
      autoDownload: true,
      maxSize: 600,
      maxFps: 0,
      flip: false,
      bitrate: 999999999,
      lockedVideoOrientation: OrientationMap.LOCK_VIDEO_ORIENTATION_UNLOCKED,
      tunnelForward: true,
      tunnelDelay: 1000,
      crop: '',
      sendFrameMeta: true, // send PTS so that the client may record properly
      control: true,
      displayId: 0,
      showTouches: false,
      stayAwake: true,
      codecOptions: '',
      encoderName: '',
      powerOffScreenOnClose: false,
      ...config,
    };
    this._name = new Promise<string>((resolve) => (this.setName = resolve));
    this._width = new Promise<number>((resolve) => {
      this.setWidth = (w) => {
        this.currentWidth = w;
        resolve(w);
      };
    });
    this._height = new Promise<number>((resolve) => {
      this.setHeight = (h) => {
        this.currentHeight = h;
        resolve(h);
      };
    });
    this._codec = new Promise<string>((resolve) => (this.setCodec = resolve));
    this._onTermination = new Promise<string>((resolve) => (this.setFatalError = resolve));
    this._firstFrame = new Promise<void>((resolve) => (this.setFirstFrame = resolve));

    const parsed = parseScrcpyVersionParts(this.config.version);
    this.major = parsed.major;
    this.minor = parsed.minor;
    this.patch = parsed.patch;
    this.strVersion = parsed.strVersion;
  }

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener);
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener);
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener);
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args);

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
   * get last current video config
   */
  get videoConfig(): H264Configuration | undefined {
    return this.lastConf;
  }

  /**
   * emit scrcpyServer output as Error
   */
  async ListenErrors(duplex: PromiseDuplex<Duplex>): Promise<void> {
    try {
      const errors: string[] = [];
      for (; ;) {
        if (!duplex.readable) {
          break;
        }
        await Utils.waitforReadable(duplex, 0, 'wait for error from ScrcpyServer');
        const data = await duplex.read();
        if (data) {
          const msg = data.toString().trim();
          errors.push(msg);
          try {
            this.emit('error', Error(msg));
          } catch (_e: unknown) {
            // emit Error but do not want to Quit Yet
          }
        } else {
          if (errors.length > 0) {
            this._setFatalError(errors.join('\n'));
          }
          break;
        }
      }
    } catch (_e: unknown) {
      // must never throw
    }
  }

  private _setFatalError(msg: string | Error): void {
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
   * Read a message from the controller Duplex
   *
   * @param duplex only support clipboard
   */
  async readOneMessage(duplex: PromiseDuplex<Duplex>): Promise<string> {
    return readDeviceMessage(duplex);
  }

  public getStartupLine(jarDest = '/data/local/tmp/scrcpy-server.jar'): string {
    return this._getStartupLine(jarDest);
  }

  private _getStartupLine(jarDest: string): string {
    return buildScrcpyStartupLine(
      this.config,
      {
        major: this.major,
        minor: this.minor,
        patch: this.patch,
        strVersion: this.strVersion,
      },
      jarDest,
    );
  }

  private async resolveLocalJar(): Promise<{ jar: string; stat: fs.Stats }> {
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
    return { jar, stat: srcStat };
  }

  private async deployServerJar(): Promise<string> {
    const checkDir = async (dirPath: string): Promise<Stats | null> => {
      try {
        return await this.client.stat(dirPath);
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
      throw Error('can not find a writable tmp dest folder in device');
    }

    const jarDest = `${dstFolder}/scrcpy-server-v${this.config.version}.jar`;
    const { jar, stat: srcStat } = await this.resolveLocalJar();
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
    return jarDest;
  }

  private async connectVideoSocket(socketName: string): Promise<PromiseDuplex<Duplex>> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await Utils.delay(attempt === 0 ? 150 : 250);
        return new PromiseDuplex(await this.client.openLocal(`localabstract:${socketName}`));
      } catch (err) {
        if (attempt === 4 || this.closed) {
          throw err;
        }
      }
    }
    throw Error('fail to connect videoSocket');
  }

  /**
   * Will connect to the android device, send & run the server and return deviceName, width and height.
   * After that data will be offered as a 'data' event.
   */
  async start(): Promise<this> {
    if (this.closed) {
      return this;
    }

    const jarDest = await this.deployServerJar();
    try {
      const cmdLine = this._getStartupLine(jarDest);
      if (this.closed) {
        return this;
      }
      const duplex = await this.client.shell(cmdLine);
      this.scrcpyServer = new PromiseDuplex(duplex);
      this.scrcpyServer.stream.once('close', () => {
        debug(`scrcpyServer finished on device ${this.client.serial}`);
        this.stop();
      });
    } catch (e) {
      debug('Impossible to run server:', e);
      throw e;
    }

    let stdoutContent = '';
    for (; ;) {
      if (!await Utils.waitforReadable(this.scrcpyServer, this.config.tunnelDelay, 'scrcpyServer stdout loading')) {
        if (!stdoutContent) {
          stdoutContent = 'no stdout content';
        }
        const error = `Starting scrcpyServer failed, scrcpy stdout:${stdoutContent}`;
        this._setFatalError(error);
        this.stop();
        throw Error(error);
      }
      const srvOut = await this.scrcpyServer.read();
      stdoutContent += srvOut ? srvOut.toString() : '';
      const errorIndex = stdoutContent.indexOf('[server] ERROR:');
      if (errorIndex >= 0) {
        const error = stdoutContent.substring(errorIndex);
        this._setFatalError(error);
        this.stop();
        throw Error(error);
      }
      if (stdoutContent.includes('[server] INFO: Device: ')) {
        break;
      }
    }

    this.ListenErrors(this.scrcpyServer).then(() => { }, () => { });

    let socketName = 'scrcpy';
    if (this.major >= 2) {
      socketName = SC_SOCKET_NAME_PREFIX + this.config.scid;
      assert(this.config.scid.length == 8, 'scid length should be 8');
    }

    if (this.closed) {
      return this;
    }

    this.videoSocket = await this.connectVideoSocket(socketName);
    this.videoSocket.stream.on('error', (e) => {
      console.error('videoSocket error', e);
    });

    if (this.closed) {
      this.stop();
      return this;
    }

    if (this.major >= 2 && !this.config.noAudio) {
      this.audioSocket = new PromiseDuplex(await this.client.openLocal(`localabstract:${socketName}`));
      if (this.closed) {
        this.stop();
        return this;
      }
    }

    this.controlSocket = new PromiseDuplex(await this.client.openLocal(`localabstract:${socketName}`));
    if (this.closed) {
      this.stop();
      return this;
    }

    try {
      await Utils.waitforReadable(this.videoSocket, 0, 'videoSocket 1st 1 bit chunk');
      const firstChunk = (await this.videoSocket.read(1)) as Uint8Array;
      if (!firstChunk) {
        throw Error('fail to read firstChunk, inclease tunnelDelay for this device.');
      }
      const control = firstChunk.at(0);
      if (control !== 0) {
        if (control) {
          throw Error(`Control code should be 0x00, receves: 0x${control.toString(16).padStart(2, '0')}`);
        }
        throw Error('Control code should be 0x00, receves nothing.');
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
    if (this.scrcpyServer) {
      this.scrcpyServer.destroy();
    }
    if (close) {
      this.emit('disconnect');
      this._setFatalError('stoped');
    }
    return close;
  }

  isRunning(): boolean {
    return !!this.videoSocket;
  }

  private startStreamRaw(): void {
    assert(this.videoSocket);
    this.videoSocket.stream.on('data', (d) => this.emit('raw', d));
  }

  /**
   * capture all video trafique in a loop
   * get resolve once capture stop
   */
  private async startStreamWithMeta(): Promise<void> {
    assert(this.videoSocket);
    await readScrcpyVideoStream({
      getVideoSocket: () => this.videoSocket,
      major: this.major,
      sendFrameMeta: this.config.sendFrameMeta,
      getCurrentDimensions: () => ({ width: this.currentWidth, height: this.currentHeight }),
      onName: (name) => this.setName(name),
      onCodec: (codec) => this.setCodec(codec),
      onDimensions: (width, height) => {
        this.setWidth(width);
        this.setHeight(height);
      },
      onCodecEvent: (data) => this.emit('codec', data),
      onConfig: (conf) => {
        this.lastConf = conf;
        this.emit('config', conf);
      },
      onFrame: (frame) => {
        if (this.setFirstFrame) {
          this.setFirstFrame();
          this.setFirstFrame = undefined;
        }
        this.emit('frame', frame);
      },
    });
  }

  private async writeControl(buf: Buffer): Promise<void> {
    assert(this.controlSocket);
    await this.controlSocket.write(buf);
  }

  // ControlMessages

  /**
   * // will be convert in a android.view.KeyEvent
   * https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/view/KeyEvent.java
   * @param action
   * @param keyCode
   * @param repeatCount
   * @param metaState  combinaison of KeyEventMeta
   */
  async injectKeycodeEvent(action: MotionEvent, keyCode: KeyCodes, repeatCount: number, metaState: number): Promise<void> {
    await this.writeControl(buildKeycodeMessage(action, keyCode, repeatCount, metaState));
  }

  async injectText(text: string): Promise<void> {
    await this.writeControl(buildStringControlMessage(ControlMessageMap.TYPE_INJECT_TEXT, text));
  }

  /**
   * android.view.MotionEvent;
   * https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/view/MotionEvent.java
   */
  async injectTouchEvent(
    action: MotionEvent,
    pointerId: bigint,
    position: Point,
    screenSize: Point,
    pressure: number = MotionEventMap.ACTION_UP,
    actionButton: number = MotionEventMap.BUTTON_PRIMARY,
    buttons: number = MotionEventMap.BUTTON_PRIMARY,
  ): Promise<boolean> {
    const buf = buildTouchEventMessage(this.major, action, pointerId, position, screenSize, pressure, actionButton, buttons);
    assert(this.controlSocket);
    try {
      await this.controlSocket.write(buf);
      return true;
    } catch (e) {
      debug('injectTouchEvent failed:', e);
      return false;
    }
  }

  async injectScrollEvent(position: Point, screenSize: Point, HScroll: number, VScroll: number): Promise<void> {
    await this.writeControl(buildScrollEventMessage(position, screenSize, HScroll, VScroll));
  }

  async injectBackOrScreenOn(): Promise<void> {
    await this.writeControl(buildBackOrScreenOnMessage());
  }

  async expandNotificationPanel(): Promise<void> {
    await this.writeControl(buildSimpleControlMessage(ControlMessageMap.TYPE_EXPAND_NOTIFICATION_PANEL));
  }

  async collapsePanels(): Promise<void> {
    await this.writeControl(buildSimpleControlMessage(ControlMessageMap.TYPE_COLLAPSE_PANELS));
  }

  /** @deprecated Use {@link collapsePanels} instead. */
  async collapsePannels(): Promise<void> {
    return this.collapsePanels();
  }

  async getClipboard(): Promise<string> {
    await this.writeControl(buildSimpleControlMessage(ControlMessageMap.TYPE_GET_CLIPBOARD));
    assert(this.controlSocket);
    return this.readOneMessage(this.controlSocket);
  }

  async setClipboard(text: string): Promise<void> {
    await this.writeControl(buildSetClipboardMessage(text));
  }

  async setScreenPowerMode(mode: SurfaceControl | boolean = SurfaceControlMap.POWER_MODE_NORMAL): Promise<void> {
    await this.writeControl(buildSetScreenPowerModeMessage(this.major, mode));
  }

  async startApp(packageName: string): Promise<void> {
    await this.writeControl(buildStringControlMessage(ControlMessageMap.TYPE_START_APP, packageName));
  }

  async resetVideo(): Promise<void> {
    await this.writeControl(buildSimpleControlMessage(ControlMessageMap.TYPE_RESET_VIDEO));
  }

  async rotateDevice(): Promise<void> {
    await this.writeControl(buildSimpleControlMessage(ControlMessageMap.TYPE_ROTATE_DEVICE));
  }

  async setCameraTorch(on: boolean): Promise<void> {
    await this.writeControl(buildSetCameraTorchMessage(on));
  }

  async cameraZoomIn(): Promise<void> {
    await this.writeControl(buildSimpleControlMessage(ControlMessageMap.TYPE_CAMERA_ZOOM_IN));
  }

  async cameraZoomOut(): Promise<void> {
    await this.writeControl(buildSimpleControlMessage(ControlMessageMap.TYPE_CAMERA_ZOOM_OUT));
  }

  async resizeDisplay(width: number, height: number): Promise<void> {
    await this.writeControl(buildResizeDisplayMessage(width, height));
  }

  async scanFile(filePath: string): Promise<void> {
    await this.writeControl(buildStringControlMessage(ControlMessageMap.TYPE_SCAN_FILE, filePath));
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
    const host: ScrcpyRecorderHost = {
      configSnapshot: {
        videoCodec: this.config.videoCodec,
        maxFps: this.config.maxFps,
      },
      codec: this.codec,
      width: this.width,
      height: this.height,
      onTermination: this.onTermination,
      getCurrentDimensions: () => ({ width: this.currentWidth, height: this.currentHeight }),
      getVideoStream: () => this.videoSocket?.stream,
      start: () => this.start(),
      stop: () => this.stop(),
      on: (event, listener) => this.on(event, listener as never),
      off: (event, listener) => this.off(event, listener as never),
    };
    return recordScrcpyToFile(host, destPath, options);
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
    scrcpy.on('error', () => { });
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
