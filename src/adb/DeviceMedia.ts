import { Duplex } from 'node:stream';
import { DOMParser } from '@xmldom/xmldom';
import type { DeviceClientOptions } from '../models/DeviceClientOptions.js';
import Connection from './connection.js';
import ScreencapCommand from './command/host-transport/screencap.js';
import type { VideoEncoderInfo } from './thirdparty/scrcpy/ScrcpyModels.js';

/**
 * Map an Android media MIME type (e.g. `'video/avc'`) to a normalized codec name.
 */
export function mapVideoMimeToCodec(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('avc')) return 'h264';
  if (lower.includes('hevc')) return 'h265';
  if (lower.includes('av01') || lower.includes('av1')) return 'av1';
  if (lower.includes('vp8')) return 'vp8';
  if (lower.includes('vp9')) return 'vp9';
  return 'unknown';
}

/**
 * Parse concatenated Android `media_codecs*.xml` contents and return enabled non-secure video encoders.
 */
export function parseMediaCodecsEncoders(xmlOutput: string): VideoEncoderInfo[] {
  const sanitized = xmlOutput
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const doc = new DOMParser({ onError: () => {} }).parseFromString(`<root>${sanitized}</root>`, 'text/xml');
  const encoders: VideoEncoderInfo[] = [];
  const seen = new Set<string>();
  const encoderSections = doc.getElementsByTagName('Encoders');

  for (let i = 0; i < encoderSections.length; i++) {
    const section = encoderSections[i];
    const mediaCodecs = section.getElementsByTagName('MediaCodec');
    for (let j = 0; j < mediaCodecs.length; j++) {
      const codecEl = mediaCodecs[j];
      const name = codecEl.getAttribute('name');
      if (!name || seen.has(name) || name.endsWith('.secure') || codecEl.getAttribute('enabled') === 'false') {
        continue;
      }
      let mime = codecEl.getAttribute('type') || '';
      if (!mime.toLowerCase().startsWith('video/')) {
        mime = '';
        const typeEls = codecEl.getElementsByTagName('Type');
        for (let k = 0; k < typeEls.length; k++) {
          const typeName = typeEls[k].getAttribute('name') || '';
          if (typeName.toLowerCase().startsWith('video/')) {
            mime = typeName;
            break;
          }
        }
      }
      if (mime.toLowerCase().startsWith('video/')) {
        seen.add(name);
        encoders.push({ name, codec: mapVideoMimeToCodec(mime) });
      }
    }
  }
  return encoders;
}

/**
 * Capture a PNG screenshot via `screencap`, closing the failed transport and falling back to `framebuffer('png')`
 * on older devices that do not support `screencap`.
 */
export async function screencapWithFallback(params: {
  getTransport: () => Promise<Connection>;
  options: DeviceClientOptions;
  fallback: () => Promise<Duplex>;
  debug: (msg: string) => void;
}): Promise<Duplex> {
  const { getTransport, options, fallback, debug } = params;
  const transport = await getTransport();
  try {
    return await new ScreencapCommand(transport, options).execute();
  } catch (err) {
    transport.end();
    debug(`Emulating screencap command due to '${err}'`);
    return fallback();
  }
}

/**
 * Query Android `media_codecs*.xml` files and return parsed video encoders, or `[]` if unavailable.
 */
export async function listDeviceVideoEncoders(
  execOut: (command: string, encoding: 'utf8') => Promise<string>,
): Promise<VideoEncoderInfo[]> {
  try {
    const output = await execOut(
      'cat /vendor/etc/media_codecs*.xml /system/etc/media_codecs*.xml /etc/media_codecs*.xml 2>/dev/null',
      'utf8',
    );
    return parseMediaCodecsEncoders(output);
  } catch {
    return [];
  }
}
