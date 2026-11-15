import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { Duplex } from 'node:stream';
import Utils from '../../utils.js';
import type {
  H264Configuration,
  ScrcpyOptions,
  VideoRecordOptions,
  VideoRecordResult,
  VideoStreamFramePacket,
} from './ScrcpyModels.js';

const debug = Utils.debug('adb:scrcpy');

export interface ScrcpyRecorderHost {
  readonly configSnapshot: Pick<ScrcpyOptions, 'videoCodec' | 'maxFps'>;
  readonly codec: Promise<string>;
  readonly width: Promise<number>;
  readonly height: Promise<number>;
  readonly onTermination: Promise<string>;
  getCurrentDimensions(): { width: number; height: number };
  getVideoStream(): Duplex | undefined;
  start(): Promise<unknown>;
  stop(): boolean;
  on(event: 'config', listener: (conf: H264Configuration) => void): unknown;
  on(event: 'frame', listener: (packet: VideoStreamFramePacket) => void): unknown;
  off(event: 'config', listener: (conf: H264Configuration) => void): unknown;
  off(event: 'frame', listener: (packet: VideoStreamFramePacket) => void): unknown;
}

function resolveRawExtension(videoCodec?: string): string {
  if (!videoCodec) {
    return 'h264';
  }
  const vc = videoCodec.toLowerCase();
  if (vc.includes('265') || vc.includes('hevc')) return 'h265';
  if (vc.includes('av1')) return 'av1';
  return 'h264';
}

async function remuxRawToMp4(rawPath: string, mp4Target: string, fps: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-y', '-r', fps.toString(), '-i', rawPath, '-c', 'copy', '-movflags', '+faststart', mp4Target],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

async function finalizeFileStream(fileStream: fs.WriteStream): Promise<Error | null> {
  if (fileStream.destroyed || fileStream.writableEnded) {
    return null;
  }
  return new Promise<Error | null>((resolve) => {
    let endErr: Error | null = null;
    const onEndErr = (err: Error) => {
      fileStream.off('finish', onFinish);
      endErr = err;
      resolve(endErr);
    };
    const onFinish = () => {
      fileStream.off('error', onEndErr);
      resolve(null);
    };
    fileStream.once('error', onEndErr);
    fileStream.once('finish', onFinish);
    fileStream.end();
  });
}

/**
 * Record a scrcpy video stream directly to disk and optionally remux into MP4 via `ffmpeg`.
 */
export async function recordScrcpyToFile(
  host: ScrcpyRecorderHost,
  destPath: string,
  options: VideoRecordOptions = {},
): Promise<VideoRecordResult> {
  const isMp4 = destPath.toLowerCase().endsWith('.mp4');
  const shouldRemux = options.remuxMp4 ?? isMp4;
  const resolvedPath = path.resolve(destPath);
  const destDir = path.dirname(resolvedPath);
  if (!fs.existsSync(destDir)) {
    await fs.promises.mkdir(destDir, { recursive: true });
  }

  const defaultExt = resolveRawExtension(host.configSnapshot.videoCodec);
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
      host.stop();
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
      host.getVideoStream()?.resume();
    }
  };

  const writeToFile = (data: Uint8Array) => {
    if (streamError || fileStream.destroyed || fileStream.writableEnded) {
      return;
    }
    const ok = fileStream.write(Buffer.from(data));
    if (!ok && !isBackpressured) {
      isBackpressured = true;
      host.getVideoStream()?.pause();
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

  host.on('config', onConfig);
  host.on('frame', onFrame);

  let trySucceeded = false;
  try {
    if (streamError) {
      throw streamError;
    }
    await host.start();
    await host.onTermination;
    trySucceeded = true;
  } finally {
    if (stopTimer) clearTimeout(stopTimer);
    if (options.signal && abortListener) {
      options.signal.removeEventListener('abort', abortListener);
    }
    host.off('config', onConfig);
    host.off('frame', onFrame);
    stopRecording();
    fileStream.off('drain', onDrain);
    fileStream.off('error', onStreamError);
    const endErr = await finalizeFileStream(fileStream);
    if (!streamError && endErr) {
      streamError = endErr;
    }
  }
  if (trySucceeded && streamError) {
    throw streamError;
  }

  const durationMs = Date.now() - startTime;
  const fallbackCodec = host.configSnapshot.videoCodec ? host.configSnapshot.videoCodec.toUpperCase() : 'H264';
  let detectedCodec = fallbackCodec;
  try {
    detectedCodec = await Promise.race([
      host.codec,
      Utils.delay(50).then(() => fallbackCodec),
    ]);
  } catch {
    // ignore
  }

  const dims = host.getCurrentDimensions();
  let finalWidth = 0;
  let finalHeight = 0;
  try {
    finalWidth = await Promise.race([host.width, Utils.delay(50).then(() => dims.width)]);
    finalHeight = await Promise.race([host.height, Utils.delay(50).then(() => dims.height)]);
  } catch {
    // ignore
  }

  let finalFilePath = rawPath;
  let remuxError: string | undefined;

  if (shouldRemux) {
    const mp4Target = isMp4 ? resolvedPath : resolvedPath.replace(/\.[^.]+$/, '.mp4');
    const fps = options.framerate || host.configSnapshot.maxFps || 30;
    try {
      await remuxRawToMp4(rawPath, mp4Target, fps);
      finalFilePath = mp4Target;
      if (isMp4 && rawPath !== mp4Target && fs.existsSync(mp4Target)) {
        await fs.promises.unlink(rawPath).catch(() => {});
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
