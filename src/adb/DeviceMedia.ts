import { DOMParser } from '@xmldom/xmldom';
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
