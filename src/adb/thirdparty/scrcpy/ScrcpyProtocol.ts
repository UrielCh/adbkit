import { Buffer } from 'node:buffer';
import { Duplex } from 'node:stream';
import PromiseDuplex from 'promise-duplex';
import Utils from '../../utils.js';
import { codexMap } from './ScrcpyConst.js';
import { getVuiColorimetry, getVuiFrameRate, getVuiSampleAspectRatio, parse_sequence_parameter_set } from './sps.js';
import type { H264Configuration, VideoStreamFramePacket } from './ScrcpyModels.js';

const CODEC_NAME_BY_ID: ReadonlyMap<number, string> = new Map<number, string>([
  [codexMap.H264, 'H264'],
  [codexMap.H265, 'H265'],
  [codexMap.AV1, 'AV1'],
  [codexMap.VP8, 'VP8'],
  [codexMap.VP9, 'VP9'],
  [codexMap.OPUS, 'OPUS'],
  [codexMap.AAC, 'AAC'],
  [codexMap.RAW, 'RAW'],
]);

/**
 * Map a 32-bit scrcpy codec identifier to its uppercase codec name.
 */
export function mapScrcpyCodec(codecId: number): string {
  return CODEC_NAME_BY_ID.get(codecId) ?? 'UNKNOWN';
}

/**
 * Read an exact number of bytes from a `PromiseDuplex` socket, or `null` on EOF.
 */
export async function readExact(socket: PromiseDuplex<Duplex>, size: number, ctxt = ''): Promise<Buffer | null> {
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
 * Read a single device control message (currently clipboard text) from the control socket.
 */
export async function readDeviceMessage(duplex: PromiseDuplex<Duplex>): Promise<string> {
  if (!duplex) {
    return '';
  }
  await Utils.waitforReadable(duplex);
  let chunk = (await duplex.read(1)) as Buffer;
  const type = chunk.readUInt8();
  switch (type) {
    case 0: {
      await Utils.waitforReadable(duplex);
      chunk = (await duplex.read(4)) as Buffer;
      await Utils.waitforReadable(duplex);
      const len = chunk.readUint32BE();
      await Utils.waitforReadable(duplex);
      chunk = (await duplex.read(len)) as Buffer;
      return chunk.toString('utf8');
    }
    default:
      throw Error(`Unsupported message type:${type}`);
  }
}

/**
 * Parse a video configuration packet (SPS for H264, or fallback dimensions for other codecs).
 */
export function parseVideoConfigPacket(
  streamChunk: Uint8Array,
  codec: string,
  fallbackWidth: number,
  fallbackHeight: number,
): H264Configuration {
  try {
    const sps = parse_sequence_parameter_set(streamChunk, codec);
    const encodedWidth = (sps.pic_width_in_mbs_minus1 + 1) * 16;
    const encodedHeight = (sps.pic_height_in_map_units_minus1 + 1) * (2 - sps.frame_mbs_only_flag) * 16;
    const cropLeft = sps.frame_crop_left_offset * 2;
    const cropRight = sps.frame_crop_right_offset * 2;
    const cropTop = sps.frame_crop_top_offset * 2;
    const cropBottom = sps.frame_crop_bottom_offset * 2;
    const aspectRatio = sps.vui_parameters ? getVuiSampleAspectRatio(sps.vui_parameters) : undefined;
    const frameRate = sps.vui_parameters ? getVuiFrameRate(sps.vui_parameters) : undefined;
    const colorimetry = sps.vui_parameters ? getVuiColorimetry(sps.vui_parameters) : undefined;
    return {
      profileIndex: sps.profile_idc,
      constraintSet: sps.constraint_set,
      levelIndex: sps.level_idc,
      encodedWidth,
      encodedHeight,
      cropLeft,
      cropRight,
      cropTop,
      cropBottom,
      croppedWidth: encodedWidth - cropLeft - cropRight,
      croppedHeight: encodedHeight - cropTop - cropBottom,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(frameRate !== undefined ? { frameRate } : {}),
      ...(colorimetry ? { colorimetry } : {}),
      data: streamChunk,
    };
  } catch {
    // For non-H264 codecs (e.g. H265, AV1) or unparsed SPS, store data as config
    return {
      profileIndex: 0,
      constraintSet: 0,
      levelIndex: 0,
      encodedWidth: fallbackWidth,
      encodedHeight: fallbackHeight,
      cropLeft: 0,
      cropRight: 0,
      cropTop: 0,
      cropBottom: 0,
      croppedWidth: fallbackWidth,
      croppedHeight: fallbackHeight,
      data: streamChunk,
    };
  }
}

export interface ScrcpyStreamCallbacks {
  getVideoSocket: () => PromiseDuplex<Duplex> | undefined;
  major: number;
  sendFrameMeta: boolean;
  getCurrentDimensions: () => { width: number; height: number };
  onName: (name: string) => void;
  onCodec: (codec: string) => void;
  onDimensions: (width: number, height: number) => void;
  onCodecEvent: (data: { codec: string; width: number; height: number }) => void;
  onConfig: (conf: H264Configuration) => void;
  onFrame: (frame: VideoStreamFramePacket) => void;
}

/**
 * Parse scrcpy stream headers (device name, codec, session metadata) and dispatch video packets.
 */
export async function readScrcpyVideoStream(cb: ScrcpyStreamCallbacks): Promise<void> {
  const initialSocket = cb.getVideoSocket();
  if (!initialSocket) {
    throw new Error('videoSocket is not initialized');
  }
  initialSocket.stream.pause();
  await Utils.waitforReadable(initialSocket, 0, 'videoSocket header');

  if (cb.major >= 2) {
    const chunk = await readExact(initialSocket, 64, 'videoSocket header');
    if (!chunk) {
      throw Error('fail to read firstChunk, inclease tunnelDelay for this device.');
    }
    const name = chunk.toString('utf8', 0, 64).replace(/\0/g, '').trim();
    cb.onName(name);
  } else {
    const chunk = await readExact(initialSocket, 68, 'videoSocket header');
    if (!chunk) {
      throw Error('fail to read firstChunk, inclease tunnelDelay for this device.');
    }
    const name = chunk.toString('utf8', 0, 64).replace(/\0/g, '').trim();
    cb.onName(name);
    cb.onDimensions(chunk.readUint16BE(64), chunk.readUint16BE(66));
  }

  let codec = 'H264';
  if (cb.major >= 4) {
    // 1. writeVideoHeader() sends only 4 bytes: codecId
    // 2. Initial writeSessionMeta() sends 12 bytes: flags (bit 31 = 1), width (4 bytes), height (4 bytes)
    const codecChunk = await readExact(initialSocket, 4, 'videoSocket Codec header');
    if (!codecChunk) {
      throw Error('fail to read videoSocket Codec header');
    }
    codec = mapScrcpyCodec(codecChunk.readUInt32BE(0));
    cb.onCodec(codec);

    const sessionChunk = await readExact(initialSocket, 12, 'videoSocket Session header');
    if (!sessionChunk) {
      throw Error('fail to read videoSocket Session header');
    }
    const width = sessionChunk.readUInt32BE(4);
    const height = sessionChunk.readUInt32BE(8);
    cb.onDimensions(width, height);
    cb.onCodecEvent({ codec, width, height });
  } else if (cb.major >= 2) {
    // In scrcpy 2.x and 3.x: writeVideoHeader(videoSize) sends 12 bytes: codecId, width, height
    const frameMeta = await readExact(initialSocket, 12, 'videoSocket Codec header');
    if (!frameMeta) {
      throw Error('fail to read videoSocket Codec header');
    }
    const codecId = frameMeta.readUInt32BE(0);
    const width = frameMeta.readUInt32BE(4);
    const height = frameMeta.readUInt32BE(8);
    codec = mapScrcpyCodec(codecId);
    cb.onCodec(codec);
    cb.onDimensions(width, height);
    cb.onCodecEvent({ codec, width, height });
  }

  const flagConfig = cb.major >= 4 ? (BigInt(1) << BigInt(62)) : (BigInt(1) << BigInt(63));
  const flagKeyFrame = cb.major >= 4 ? (BigInt(1) << BigInt(61)) : (BigInt(1) << BigInt(62));

  let pts = BigInt(0);
  let lastConf: H264Configuration | undefined;

  for (; ;) {
    const socket = cb.getVideoSocket();
    if (!socket) {
      break;
    }
    let len: number | undefined;
    if (cb.sendFrameMeta) {
      const frameMeta = await readExact(socket, 12, 'videoSocket packet size');
      if (!frameMeta) {
        return;
      }

      // In scrcpy 4.0+, a 12-byte header with bit 63 set is a session packet (no payload data follows)
      if (cb.major >= 4 && (frameMeta[0] & 0x80) !== 0) {
        const newWidth = frameMeta.readUInt32BE(4);
        const newHeight = frameMeta.readUInt32BE(8);
        cb.onDimensions(newWidth, newHeight);
        cb.onCodecEvent({ codec, width: newWidth, height: newHeight });
        continue;
      }

      pts = frameMeta.readBigUint64BE();
      len = frameMeta.readUInt32BE(8);
    }

    const isConfig = !!(pts & flagConfig);
    let streamChunk: Uint8Array | null = null;

    while (streamChunk === null) {
      const currentSocket = cb.getVideoSocket();
      if (!currentSocket || !currentSocket.stream.readable) {
        break;
      }
      await Utils.waitforReadable(currentSocket, 0, 'videoSocket streamChunk');
      streamChunk = currentSocket.stream.read(len) as Uint8Array;
      if (!streamChunk) {
        await Utils.delay(0);
        continue;
      }

      if (isConfig) {
        const dims = cb.getCurrentDimensions();
        lastConf = parseVideoConfigPacket(streamChunk, codec, dims.width, dims.height);
        cb.onConfig(lastConf);
      } else {
        const keyframe = !!(pts & flagKeyFrame);
        if (keyframe) {
          pts &= ~flagKeyFrame;
        }
        cb.onFrame({ keyframe, pts, data: streamChunk, config: lastConf });
      }
    }
  }
}
