import type DeviceClient from '../src/adb/DeviceClient.js';

export interface ParsedAppIcon {
  data: Buffer;
  mime: string;
}

export interface ParsedApkMetadata {
  label?: string;
  icon?: ParsedAppIcon;
  versionName?: string;
  versionCode?: number;
}

interface StringPool {
  strings: string[];
}

interface ManifestApplicationInfo {
  labelStr?: string;
  labelResId?: number;
  iconResId?: number;
  roundIconResId?: number;
  versionNameStr?: string;
  versionNameResId?: number;
  versionCode?: number;
}

interface ResourceCandidate {
  density: number;
  language: string;
  strValue?: string;
  refId?: number;
}

const RES_STRING_POOL_TYPE = 0x0001;
const RES_TABLE_TYPE = 0x0002;
const RES_XML_TYPE = 0x0003;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_TABLE_PACKAGE_TYPE = 0x0200;
const RES_TABLE_TYPE_TYPE = 0x0201;

const ATTR_ID_LABEL = 0x01010001;
const ATTR_ID_ICON = 0x01010002;
const ATTR_ID_DRAWABLE = 0x01010199;
const ATTR_ID_VERSION_CODE = 0x0101021b;
const ATTR_ID_VERSION_NAME = 0x0101021c;
const ATTR_ID_PATH_DATA = 0x01010405;
const ATTR_ID_FILL_COLOR = 0x01010404;
const ATTR_ID_VIEWPORT_WIDTH = 0x01010402;
const ATTR_ID_VIEWPORT_HEIGHT = 0x01010403;
const ATTR_ID_ROUND_ICON = 0x0101052c;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_FLOAT = 0x04;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_COLOR_ARGB8 = 0x1c;
const TYPE_INT_COLOR_RGB8 = 0x1d;
const TYPE_INT_COLOR_ARGB4 = 0x1e;
const TYPE_INT_COLOR_RGB4 = 0x1f;

function readUtf8Length(buf: Buffer, offset: number): { value: number; next: number } {
  const first = buf.readUInt8(offset);
  if ((first & 0x80) !== 0) {
    const second = buf.readUInt8(offset + 1);
    return { value: ((first & 0x7f) << 8) | second, next: offset + 2 };
  }
  return { value: first, next: offset + 1 };
}

function readUtf16Length(buf: Buffer, offset: number): { value: number; next: number } {
  const first = buf.readUInt16LE(offset);
  if ((first & 0x8000) !== 0) {
    const second = buf.readUInt16LE(offset + 2);
    return { value: ((first & 0x7fff) << 16) | second, next: offset + 4 };
  }
  return { value: first, next: offset + 2 };
}

function parseStringPool(buf: Buffer, chunkStart: number, chunkSize: number): StringPool {
  if (chunkStart + 28 > buf.length) return { strings: [] };
  const stringCount = buf.readUInt32LE(chunkStart + 8);
  const flags = buf.readUInt32LE(chunkStart + 16);
  const stringsStart = buf.readUInt32LE(chunkStart + 20);
  const isUtf8 = (flags & 0x100) !== 0;

  const offsetsStart = chunkStart + 28;
  const dataBase = chunkStart + stringsStart;
  const chunkEnd = Math.min(buf.length, chunkStart + chunkSize);
  const strings: string[] = new Array<string>(stringCount);

  for (let i = 0; i < stringCount; i++) {
    const offPos = offsetsStart + i * 4;
    if (offPos + 4 > chunkEnd) {
      strings[i] = '';
      continue;
    }
    const rel = buf.readUInt32LE(offPos);
    const strPos = dataBase + rel;
    if (strPos >= chunkEnd) {
      strings[i] = '';
      continue;
    }
    if (isUtf8) {
      const charLen = readUtf8Length(buf, strPos);
      if (charLen.next >= chunkEnd) {
        strings[i] = '';
        continue;
      }
      const byteLen = readUtf8Length(buf, charLen.next);
      const end = Math.min(chunkEnd, byteLen.next + byteLen.value);
      strings[i] = buf.subarray(byteLen.next, end).toString('utf8');
    } else {
      const charLen = readUtf16Length(buf, strPos);
      const end = Math.min(chunkEnd, charLen.next + charLen.value * 2);
      strings[i] = buf.subarray(charLen.next, end).toString('utf16le');
    }
  }

  return { strings };
}

interface AxmlAttr {
  name: string;
  resId: number;
  rawValue?: string;
  dataType: number;
  data: number;
}

interface AxmlElement {
  name: string;
  attrs: AxmlAttr[];
}

/**
 * Parse Android binary XML (AXML) into a flat list of start elements with attributes.
 */
export function parseAxmlElements(buf: Buffer): { elements: AxmlElement[]; strings: string[] } {
  if (buf.length < 8 || buf.readUInt16LE(0) !== RES_XML_TYPE) {
    return { elements: [], strings: [] };
  }

  let strings: string[] = [];
  let resourceIds: number[] = [];
  const elements: AxmlElement[] = [];

  let offset = buf.readUInt16LE(2);
  while (offset + 8 <= buf.length) {
    const chunkType = buf.readUInt16LE(offset);
    const headerSize = buf.readUInt16LE(offset + 2);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkSize < 8 || offset + chunkSize > buf.length) break;

    if (chunkType === RES_STRING_POOL_TYPE) {
      strings = parseStringPool(buf, offset, chunkSize).strings;
    } else if (chunkType === RES_XML_RESOURCE_MAP_TYPE) {
      const count = Math.floor((chunkSize - headerSize) / 4);
      resourceIds = new Array<number>(count);
      for (let i = 0; i < count; i++) {
        resourceIds[i] = buf.readUInt32LE(offset + headerSize + i * 4);
      }
    } else if (chunkType === RES_XML_START_ELEMENT_TYPE && offset + headerSize + 20 <= buf.length) {
      const ext = offset + headerSize;
      const nameIdx = buf.readUInt32LE(ext + 4);
      const attrStart = buf.readUInt16LE(ext + 8);
      const attrSize = buf.readUInt16LE(ext + 10);
      const attrCount = buf.readUInt16LE(ext + 12);
      const attrs: AxmlAttr[] = [];

      for (let i = 0; i < attrCount; i++) {
        const aPos = ext + attrStart + i * attrSize;
        if (aPos + 20 > offset + chunkSize) break;
        const attrNameIdx = buf.readUInt32LE(aPos + 4);
        const rawValueIdx = buf.readUInt32LE(aPos + 8);
        const dataType = buf.readUInt8(aPos + 15);
        const data = buf.readUInt32LE(aPos + 16);
        attrs.push({
          name: strings[attrNameIdx] ?? '',
          resId: resourceIds[attrNameIdx] ?? 0,
          rawValue: rawValueIdx !== 0xffffffff ? strings[rawValueIdx] : undefined,
          dataType,
          data,
        });
      }
      elements.push({ name: strings[nameIdx] ?? '', attrs });
    }

    offset += chunkSize;
  }

  return { elements, strings };
}

/**
 * Extract `<manifest>` version info and `<application>` label/icon references from binary AndroidManifest.xml.
 */
export function extractManifestAppInfo(manifestBuf: Buffer): ManifestApplicationInfo {
  const { elements, strings } = parseAxmlElements(manifestBuf);
  const info: ManifestApplicationInfo = {};

  const manifestEl = elements.find(e => e.name === 'manifest');
  if (manifestEl) {
    for (const attr of manifestEl.attrs) {
      if (attr.resId === ATTR_ID_VERSION_NAME || attr.name === 'versionName') {
        if (attr.dataType === TYPE_STRING && strings[attr.data]) {
          info.versionNameStr = strings[attr.data];
        } else if (attr.dataType === TYPE_REFERENCE && attr.data !== 0) {
          info.versionNameResId = attr.data;
        } else if (attr.dataType === TYPE_INT_DEC) {
          info.versionNameStr = String(attr.data);
        } else if (attr.rawValue) {
          info.versionNameStr = attr.rawValue;
        }
      } else if (attr.resId === ATTR_ID_VERSION_CODE || attr.name === 'versionCode') {
        if (attr.dataType === TYPE_INT_DEC || attr.dataType === TYPE_INT_HEX) {
          info.versionCode = attr.data;
        } else if (attr.dataType === TYPE_STRING && strings[attr.data]) {
          const parsed = Number.parseInt(strings[attr.data], 10);
          if (Number.isFinite(parsed)) info.versionCode = parsed;
        }
      }
    }
  }

  const appEl = elements.find(e => e.name === 'application');
  if (!appEl) return info;

  for (const attr of appEl.attrs) {
    if (attr.resId === ATTR_ID_LABEL || attr.name === 'label') {
      if (attr.dataType === TYPE_STRING && strings[attr.data]) {
        info.labelStr = strings[attr.data];
      } else if (attr.dataType === TYPE_REFERENCE && attr.data !== 0) {
        info.labelResId = attr.data;
      } else if (attr.rawValue) {
        info.labelStr = attr.rawValue;
      }
    } else if (attr.resId === ATTR_ID_ICON || attr.name === 'icon') {
      if (attr.dataType === TYPE_REFERENCE && attr.data !== 0) {
        info.iconResId = attr.data;
      }
    } else if (attr.resId === ATTR_ID_ROUND_ICON || attr.name === 'roundIcon') {
      if (attr.dataType === TYPE_REFERENCE && attr.data !== 0) {
        info.roundIconResId = attr.data;
      }
    }
  }
  return info;
}

/**
 * Parse Android `resources.arsc` and return a lookup map from resource ID to candidate values.
 */
export function parseResourcesTable(arscBuf: Buffer): Map<number, ResourceCandidate[]> {
  const table = new Map<number, ResourceCandidate[]>();
  if (arscBuf.length < 12 || arscBuf.readUInt16LE(0) !== RES_TABLE_TYPE) {
    return table;
  }

  let globalStrings: string[] = [];
  let offset = arscBuf.readUInt16LE(2);

  while (offset + 8 <= arscBuf.length) {
    const chunkType = arscBuf.readUInt16LE(offset);
    const headerSize = arscBuf.readUInt16LE(offset + 2);
    const chunkSize = arscBuf.readUInt32LE(offset + 4);
    if (chunkSize < 8 || offset + chunkSize > arscBuf.length) break;

    if (chunkType === RES_STRING_POOL_TYPE) {
      globalStrings = parseStringPool(arscBuf, offset, chunkSize).strings;
    } else if (chunkType === RES_TABLE_PACKAGE_TYPE && offset + headerSize <= offset + chunkSize) {
      const pkgId = arscBuf.readUInt32LE(offset + 8);
      const pkgEnd = offset + chunkSize;
      let innerOffset = offset + headerSize;

      while (innerOffset + 8 <= pkgEnd) {
        const innerType = arscBuf.readUInt16LE(innerOffset);
        const innerHeaderSize = arscBuf.readUInt16LE(innerOffset + 2);
        const innerSize = arscBuf.readUInt32LE(innerOffset + 4);
        if (innerSize < 8 || innerOffset + innerSize > pkgEnd) break;

        if (innerType === RES_TABLE_TYPE_TYPE && innerOffset + 24 <= innerOffset + innerSize) {
          const typeId = arscBuf.readUInt8(innerOffset + 8);
          const entryCount = arscBuf.readUInt32LE(innerOffset + 12);
          const entriesStart = arscBuf.readUInt32LE(innerOffset + 16);
          const configSize = arscBuf.readUInt32LE(innerOffset + 20);

          let language = '';
          let density = 0;
          if (configSize >= 12 && innerOffset + 32 <= innerOffset + innerSize) {
            const c0 = arscBuf.readUInt8(innerOffset + 28);
            const c1 = arscBuf.readUInt8(innerOffset + 29);
            if (c0 >= 0x61 && c0 <= 0x7a && c1 >= 0x61 && c1 <= 0x7a) {
              language = String.fromCharCode(c0, c1);
            }
          }
          if (configSize >= 16 && innerOffset + 36 <= innerOffset + innerSize) {
            density = arscBuf.readUInt16LE(innerOffset + 34);
          }

          const offsetsBase = innerOffset + innerHeaderSize;
          const entriesBase = innerOffset + entriesStart;
          const typeEnd = innerOffset + innerSize;

          for (let entryId = 0; entryId < entryCount; entryId++) {
            const offPos = offsetsBase + entryId * 4;
            if (offPos + 4 > typeEnd) break;
            const entryRel = arscBuf.readUInt32LE(offPos);
            if (entryRel === 0xffffffff) continue;

            const entryPos = entriesBase + entryRel;
            if (entryPos + 8 > typeEnd) continue;
            const entrySize = arscBuf.readUInt16LE(entryPos);
            const entryFlags = arscBuf.readUInt16LE(entryPos + 2);
            if ((entryFlags & 0x0001) !== 0) continue; // skip complex bag entries

            const valPos = entryPos + entrySize;
            if (valPos + 8 > typeEnd) continue;
            const dataType = arscBuf.readUInt8(valPos + 3);
            const data = arscBuf.readUInt32LE(valPos + 4);

            const resId = ((pkgId & 0xff) << 24) | ((typeId & 0xff) << 16) | (entryId & 0xffff);
            let list = table.get(resId);
            if (!list) {
              list = [];
              table.set(resId, list);
            }
            if (dataType === TYPE_STRING && data < globalStrings.length) {
              list.push({ density, language, strValue: globalStrings[data] });
            } else if (dataType === TYPE_REFERENCE && data !== 0) {
              list.push({ density, language, refId: data });
            }
          }
        }

        innerOffset += innerSize;
      }
    }

    offset += chunkSize;
  }

  return table;
}

function resolveStringsForResId(
  table: Map<number, ResourceCandidate[]>,
  resId: number,
  visited = new Set<number>(),
): ResourceCandidate[] {
  if (visited.has(resId)) return [];
  visited.add(resId);

  const candidates = table.get(resId);
  if (!candidates) return [];

  const out: ResourceCandidate[] = [];
  for (const c of candidates) {
    if (c.strValue !== undefined) {
      out.push(c);
    } else if (c.refId !== undefined) {
      out.push(...resolveStringsForResId(table, c.refId, visited));
    }
  }
  return out;
}

function pickLabelFromCandidates(candidates: ResourceCandidate[]): string | undefined {
  const nonEmpty = candidates.filter(c => c.strValue && c.strValue.trim().length > 0);
  if (!nonEmpty.length) return undefined;
  // Prefer default locale (''), then English ('en'), then French ('fr'), then any
  nonEmpty.sort((a, b) => {
    const score = (lang: string) => (lang === '' ? 0 : lang === 'en' ? 1 : lang === 'fr' ? 2 : 3);
    return score(a.language) - score(b.language);
  });
  return nonEmpty[0].strValue?.trim();
}

const RASTER_EXT_RE = /\.(png|webp|jpg|jpeg)$/i;

function scoreDensity(density: number): number {
  switch (density) {
    case 480: return 100; // xxhdpi
    case 320: return 95;  // xhdpi
    case 640: return 90;  // xxxhdpi
    case 240: return 80;  // hdpi
    case 160: return 70;  // mdpi
    case 120: return 60;  // ldpi
    case 65535: return 50; // nodpi
    case 0: return 40;
    default: return 30;
  }
}

function pickIconPaths(candidates: ResourceCandidate[]): { rasterPath?: string; xmlPath?: string } {
  const rasters: ResourceCandidate[] = [];
  const xmls: ResourceCandidate[] = [];
  for (const c of candidates) {
    if (!c.strValue) continue;
    if (RASTER_EXT_RE.test(c.strValue)) rasters.push(c);
    else if (c.strValue.endsWith('.xml')) xmls.push(c);
  }
  rasters.sort((a, b) => scoreDensity(b.density) - scoreDensity(a.density));
  return {
    rasterPath: rasters[0]?.strValue,
    xmlPath: xmls[0]?.strValue,
  };
}

function mimeFromPath(filePath: string, data: Buffer): string {
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'image/png';
  }
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/png';
}

function isValidRasterImage(data: Buffer): boolean {
  if (data.length < 16) return false;
  // PNG
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return true;
  // WebP
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return true;
  // JPEG
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return true;
  return false;
}

function argbToCssHex(argb: number): string {
  const a = (argb >>> 24) & 0xff;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  const hex = [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  if (a === 255) return `#${hex}`;
  const alpha = a.toString(16).padStart(2, '0');
  return `#${hex}${alpha}`;
}

function readTypedNumber(attr: AxmlAttr): number | undefined {
  if (attr.dataType === TYPE_FLOAT) {
    const tmp = Buffer.allocUnsafe(4);
    tmp.writeUInt32LE(attr.data >>> 0, 0);
    return tmp.readFloatLE(0);
  }
  if (attr.dataType === TYPE_INT_DEC || attr.dataType === TYPE_INT_HEX) {
    return attr.data;
  }
  if (attr.rawValue && /^-?\d+(?:\.\d+)?$/.test(attr.rawValue)) {
    return Number(attr.rawValue);
  }
  return undefined;
}

function renderVectorAxmlToSvg(xmlBuf: Buffer): Buffer | undefined {
  const { elements, strings } = parseAxmlElements(xmlBuf);
  const vectorEl = elements.find(e => e.name === 'vector');
  if (!vectorEl) return undefined;

  let vw = 24;
  let vh = 24;
  for (const attr of vectorEl.attrs) {
    if (attr.resId === ATTR_ID_VIEWPORT_WIDTH || attr.name === 'viewportWidth') {
      vw = readTypedNumber(attr) ?? vw;
    } else if (attr.resId === ATTR_ID_VIEWPORT_HEIGHT || attr.name === 'viewportHeight') {
      vh = readTypedNumber(attr) ?? vh;
    }
  }

  const paths: string[] = [];
  for (const el of elements) {
    if (el.name !== 'path') continue;
    let d = '';
    let fill = '#5f6368';
    for (const attr of el.attrs) {
      if (attr.resId === ATTR_ID_PATH_DATA || attr.name === 'pathData') {
        d = (attr.dataType === TYPE_STRING ? strings[attr.data] : attr.rawValue) ?? '';
      } else if (attr.resId === ATTR_ID_FILL_COLOR || attr.name === 'fillColor') {
        if (
          attr.dataType === TYPE_INT_COLOR_ARGB8
          || attr.dataType === TYPE_INT_COLOR_RGB8
          || attr.dataType === TYPE_INT_COLOR_ARGB4
          || attr.dataType === TYPE_INT_COLOR_RGB4
        ) {
          fill = argbToCssHex(attr.data);
        } else if (attr.rawValue && /^#[0-9a-fA-F]{3,8}$/.test(attr.rawValue)) {
          fill = attr.rawValue;
        }
      }
    }
    if (d) {
      const safeD = d.replace(/[<>&"]/g, '');
      paths.push(`<path d="${safeD}" fill="${fill}"/>`);
    }
  }

  if (!paths.length) return undefined;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}">${paths.join('')}</svg>`;
  return Buffer.from(svg, 'utf8');
}

async function unzipEntryFromDevice(device: DeviceClient, apkPath: string, entryPath: string): Promise<Buffer> {
  try {
    return await device.execOut(['unzip', '-p', apkPath, entryPath]);
  } catch {
    return Buffer.alloc(0);
  }
}

async function readApkEntryWithSplits(device: DeviceClient, apkPath: string, pkg: string, entryPath: string): Promise<Buffer> {
  const direct = await unzipEntryFromDevice(device, apkPath, entryPath);
  if (direct.length > 0 && (!RASTER_EXT_RE.test(entryPath) || isValidRasterImage(direct))) {
    return direct;
  }

  // Some split-APK installs place density drawables in split_config.*.apk alongside base.apk.
  try {
    const pmPathRaw = await device.execOut(['pm', 'path', pkg], 'utf8');
    const paths = pmPathRaw
      .split(/\r?\n/)
      .map(line => line.trim().replace(/^package:/, ''))
      .filter(p => p && p !== apkPath);
    for (const splitPath of paths) {
      const splitData = await unzipEntryFromDevice(device, splitPath, entryPath);
      if (splitData.length > 0 && (!RASTER_EXT_RE.test(entryPath) || isValidRasterImage(splitData))) {
        return splitData;
      }
    }
  } catch {
    // ignore split fallback failure
  }
  return direct;
}

async function resolveIconFromXml(
  device: DeviceClient,
  apkPath: string,
  pkg: string,
  xmlPath: string,
  table: Map<number, ResourceCandidate[]>,
  depth = 0,
): Promise<ParsedAppIcon | undefined> {
  if (depth > 2) return undefined;
  const xmlBuf = await unzipEntryFromDevice(device, apkPath, xmlPath);
  if (xmlBuf.length < 8) return undefined;

  const { elements } = parseAxmlElements(xmlBuf);
  if (elements.some(e => e.name === 'vector')) {
    const svg = renderVectorAxmlToSvg(xmlBuf);
    if (svg) return { data: svg, mime: 'image/svg+xml' };
  }

  const drawableIds: number[] = [];
  for (const tagName of ['foreground', 'bitmap', 'background']) {
    for (const el of elements) {
      if (el.name !== tagName) continue;
      for (const attr of el.attrs) {
        if ((attr.resId === ATTR_ID_DRAWABLE || attr.name === 'drawable' || attr.name === 'src')
          && attr.dataType === TYPE_REFERENCE && attr.data !== 0) {
          drawableIds.push(attr.data);
        }
      }
    }
  }

  for (const resId of drawableIds) {
    const candidates = resolveStringsForResId(table, resId);
    const { rasterPath, xmlPath: nestedXml } = pickIconPaths(candidates);
    if (rasterPath) {
      const data = await readApkEntryWithSplits(device, apkPath, pkg, rasterPath);
      if (isValidRasterImage(data)) {
        return { data, mime: mimeFromPath(rasterPath, data) };
      }
    }
    if (nestedXml) {
      const nested = await resolveIconFromXml(device, apkPath, pkg, nestedXml, table, depth + 1);
      if (nested) return nested;
    }
  }

  return undefined;
}

/**
 * Extract human-readable application label and icon directly from an APK on the device.
 */
export async function extractApkMetadata(
  device: DeviceClient,
  pkg: string,
  apkPath?: string,
): Promise<ParsedApkMetadata> {
  let resolvedApkPath = apkPath;
  if (!resolvedApkPath) {
    try {
      const raw = await device.execOut(['pm', 'path', pkg], 'utf8');
      const firstLine = raw.split(/\r?\n/).find(l => l.trim().startsWith('package:'));
      if (firstLine) {
        resolvedApkPath = firstLine.trim().slice('package:'.length);
      }
    } catch {
      return {};
    }
  }
  if (!resolvedApkPath) return {};

  const manifestBuf = await unzipEntryFromDevice(device, resolvedApkPath, 'AndroidManifest.xml');
  if (manifestBuf.length < 8) return {};

  const appInfo = extractManifestAppInfo(manifestBuf);
  const result: ParsedApkMetadata = {
    label: appInfo.labelStr?.trim() || undefined,
    versionName: appInfo.versionNameStr?.trim() || undefined,
    versionCode: appInfo.versionCode,
  };

  const needsArsc = (!result.label && appInfo.labelResId)
    || (!result.versionName && appInfo.versionNameResId)
    || appInfo.iconResId
    || appInfo.roundIconResId;
  if (!needsArsc) return result;

  const arscBuf = await unzipEntryFromDevice(device, resolvedApkPath, 'resources.arsc');
  if (arscBuf.length < 12) return result;

  const table = parseResourcesTable(arscBuf);
  if (!result.label && appInfo.labelResId) {
    result.label = pickLabelFromCandidates(resolveStringsForResId(table, appInfo.labelResId));
  }
  if (!result.versionName && appInfo.versionNameResId) {
    result.versionName = pickLabelFromCandidates(resolveStringsForResId(table, appInfo.versionNameResId));
  }

  const iconIds = [appInfo.roundIconResId, appInfo.iconResId].filter((id): id is number => Boolean(id));
  for (const resId of iconIds) {
    const candidates = resolveStringsForResId(table, resId);
    const { rasterPath, xmlPath } = pickIconPaths(candidates);
    if (rasterPath) {
      const data = await readApkEntryWithSplits(device, resolvedApkPath, pkg, rasterPath);
      if (isValidRasterImage(data)) {
        result.icon = { data, mime: mimeFromPath(rasterPath, data) };
        break;
      }
    }
    if (xmlPath) {
      const icon = await resolveIconFromXml(device, resolvedApkPath, pkg, xmlPath, table);
      if (icon) {
        result.icon = icon;
        break;
      }
    }
  }

  return result;
}
