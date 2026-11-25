import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  KeyCodesMap,
  YaWebAdbManager,
  type AdbOptions,
  type DeviceClient,
  type KeyCodes,
  type PsEntry,
} from '../src/index.js';
import { parseHostPort } from '../src/adb/parseHostPort.js';
import { extractApkMetadata } from './apkMeta.js';
import {
  APK_DROPZONE_CSS,
  CRITICAL_PACKAGES,
  createAdbSession,
  executePackageBatch,
  fetchDeviceSummary,
  handleApkSideloadRequest,
  hidePackage,
  isFetchSiteAllowed,
  loadDevicePackages,
  logActionResult,
  logActionStart,
  mapWithConcurrency,
  readJsonBody,
  renderApkDropzoneHtml,
  renderApkDropzoneScript,
  sendJson,
  unhidePackage,
  type AdbSession,
  type AppEntry,
  type AppState,
  type DeviceSummary,
  type HideMethod,
} from './hideApps.js';

export interface TvCleanupCliOptions {
  tvIp: string;
  tvHost: string;
  tvPort: number;
  tvSerial: string;
  host?: string;
  port?: number;
  uiHost: string;
  uiPort: number;
  backend?: AdbOptions['backend'];
  openBrowser: boolean;
  help: boolean;
}

export interface StorageStats {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
}

export interface MemoryStats {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
}

export interface MemoryDetailItem {
  key: string;
  label: string;
  bytes: number;
}

export interface ProcessMemoryEntry {
  pid: string;
  name: string;
  user?: string;
  rssBytes: number;
}

export interface TvAppEntry extends AppEntry {
  running: boolean;
  suggestedBloat: boolean;
}

export interface TempFileEntry {
  path: string;
  sizeBytes: number;
}

interface CachedTvMeta {
  label?: string;
  versionName?: string;
  versionCode?: number;
  iconData?: Buffer;
  iconMime?: string;
}

export const TV_REMOTE_KEYS = {
  power: KeyCodesMap.KEYCODE_POWER,
  wakeup: KeyCodesMap.KEYCODE_WAKEUP,
  sleep: KeyCodesMap.KEYCODE_SLEEP,
  settings: KeyCodesMap.KEYCODE_SETTINGS,
  up: KeyCodesMap.KEYCODE_DPAD_UP,
  down: KeyCodesMap.KEYCODE_DPAD_DOWN,
  left: KeyCodesMap.KEYCODE_DPAD_LEFT,
  right: KeyCodesMap.KEYCODE_DPAD_RIGHT,
  center: KeyCodesMap.KEYCODE_DPAD_CENTER,
  back: KeyCodesMap.KEYCODE_BACK,
  home: KeyCodesMap.KEYCODE_HOME,
  menu: KeyCodesMap.KEYCODE_MENU,
  info: KeyCodesMap.KEYCODE_INFO,
  'vol-up': KeyCodesMap.KEYCODE_VOLUME_UP,
  'vol-down': KeyCodesMap.KEYCODE_VOLUME_DOWN,
  mute: KeyCodesMap.KEYCODE_VOLUME_MUTE,
  'ch-up': KeyCodesMap.KEYCODE_CHANNEL_UP,
  'ch-down': KeyCodesMap.KEYCODE_CHANNEL_DOWN,
  rewind: KeyCodesMap.KEYCODE_MEDIA_REWIND,
  'play-pause': KeyCodesMap.KEYCODE_MEDIA_PLAY_PAUSE,
  'fast-forward': KeyCodesMap.KEYCODE_MEDIA_FAST_FORWARD,
  prev: KeyCodesMap.KEYCODE_MEDIA_PREVIOUS,
  stop: KeyCodesMap.KEYCODE_MEDIA_STOP,
  next: KeyCodesMap.KEYCODE_MEDIA_NEXT,
} as const satisfies Record<string, KeyCodes>;

export type TvRemoteKeyName = keyof typeof TV_REMOTE_KEYS;

export function formatRemoteInputText(raw: string): string {
  if (/[\r\n\0]/.test(raw)) {
    throw new Error('Control characters are not allowed in TV text input.');
  }
  if (raw.length === 0 || raw.length > 500) {
    throw new Error('Text must be between 1 and 500 characters.');
  }
  return raw.replace(/ /g, '%s');
}

const RE_PACKAGE_NAME = /^[a-zA-Z0-9._-]+$/;
const METHODS: readonly HideMethod[] = ['auto', 'hide', 'disable', 'uninstall'];
const ALLOWED_TEMP_PREFIXES = ['/data/local/tmp/', '/sdcard/Download/'];

export const TCL_TELEMETRY_PACKAGES: readonly string[] = [
  'com.tcl.bi',
  'com.tcl.guard',
  'com.tcl.overseasappshow',
  'com.tcl.logkit',
  'com.tcl.messagebox',
  'com.tcl.usercenter',
  'com.tcl.tv.tclhome_passive',
  'com.tcl.smartalexa',
  'com.tcl.esticker',
  'com.tcl.channelplus',
  'com.tcl.waterfall.overseas',
  'com.tcl.dashboard',
  'com.tcl.magiconnectfree',
  'com.tcl.browser',
  'com.tcl.partnercustomizer',
];

export const GOOGLE_TELEMETRY_PACKAGES: readonly string[] = [
  'com.google.android.feedback',
  'com.google.android.partnersetup',
  'com.google.android.apps.nbu.smartconnect.tv',
  'com.google.android.play.games',
  'com.google.android.videos',
  'com.google.android.tvrecommendations',
];

export const TV_CRITICAL_PACKAGES = new Set<string>([
  'com.tcl.system.server',
  'com.tcl.settings',
  'com.tcl.tv',
  'com.tcl.tvinput',
  'com.tcl.inputmethod.international',
  'com.tcl.tcl_bt_rcu_service',
  'com.tcl.autopair',
  'com.tcl.keyhelp',
  'com.tcl.suspension',
  'com.tcl.providers.config',
  'com.tcl.versionUpdateApp',
  'com.tcl.initsetup',
  'com.tcl.factory.view',
  'com.tcl.android.webview',
  'com.tcl.useragreement',
  'com.android.tv.settings',
  'com.google.android.gms',
  'com.google.android.gsf',
  'com.android.vending',
]);

export type TvOptimizeCategory = 'telemetry' | 'privacy' | 'performance' | 'maintenance';
export type TvOptimizeRisk = 'safe' | 'caution';
export type TvOptimizeMode = 'apply' | 'revert';

export type TvOptimizeFixId =
  | 'disable-tcl-telemetry'
  | 'disable-google-telemetry'
  | 'disable-tcl-ttvs'
  | 'disable-ambient-mode'
  | 'disable-voice-assistant'
  | 'enable-adguard-dns'
  | 'disable-tracking-settings'
  | 'speedup-animations'
  | 'trim-caches-and-stop-bloat'
  | 'reboot-tv';

export interface TvOptimizeFix {
  readonly id: TvOptimizeFixId;
  readonly category: TvOptimizeCategory;
  readonly label: string;
  readonly summary: string;
  readonly description: string;
  readonly revertDescription?: string;
  readonly commands: readonly string[];
  readonly revertCommands?: readonly string[];
  readonly packages?: readonly string[];
  readonly risk: TvOptimizeRisk;
  readonly reversible: boolean;
  readonly requiresConfirm?: boolean;
}

export interface TvOptimizeSettings {
  privateDnsMode: string | null;
  privateDnsSpecifier: string | null;
  locationMode: string | null;
  activityStartsLogging: string | null;
  windowAnimationScale: string | null;
  transitionAnimationScale: string | null;
  animatorDurationScale: string | null;
  tclDiagnosticStatus: string | null;
  tclUxpStatus: string | null;
}

export interface TvOptimizeActionResult {
  ok: boolean;
  fixId: TvOptimizeFixId;
  mode: TvOptimizeMode;
  message: string;
  applied: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
  disconnected?: boolean;
}

export const TV_OPTIMIZE_FIXES: readonly TvOptimizeFix[] = [
  {
    id: 'disable-tcl-telemetry',
    category: 'telemetry',
    label: 'Disable TCL Telemetry & Promo Bloat',
    summary: 'Disables TCL analytics, Safety Guard, and promotional background apps while keeping core TV services intact.',
    description: 'Disables installed TCL telemetry, tracking, and promotional packages (such as com.tcl.bi, com.tcl.guard, com.tcl.overseasappshow, com.tcl.logkit, com.tcl.usercenter, and TCL promo channels) for user 0 and force-stops them immediately. Critical TCL system, HDMI input, keyboard, and Bluetooth remote packages are never touched.',
    revertDescription: 'Re-enables all installed packages in the TCL telemetry & promo group for user 0 via pm enable.',
    commands: [
      'pm disable-user --user 0 <installed TCL telemetry/promo packages>',
      'am force-stop <package>',
    ],
    revertCommands: ['pm enable --user 0 <disabled TCL telemetry/promo packages>'],
    packages: TCL_TELEMETRY_PACKAGES,
    risk: 'safe',
    reversible: true,
  },
  {
    id: 'disable-google-telemetry',
    category: 'telemetry',
    label: 'Disable Google Telemetry & Unused TV Stubs',
    summary: 'Disables Google diagnostic feedback, partner setup pings, phone setup helper, Play Games, and Play Movies.',
    description: 'Disables Google diagnostic and background helper packages (feedback, partner setup, SmartConnectTV, Play Games recommendations, and Play Videos) for user 0 and force-stops them. Google Play Store, Play Services, and Chromecast remain untouched.',
    revertDescription: 'Re-enables the disabled Google telemetry & TV stub packages for user 0.',
    commands: [
      'pm disable-user --user 0 <installed Google telemetry/stub packages>',
      'am force-stop <package>',
    ],
    revertCommands: ['pm enable --user 0 <disabled Google telemetry/stub packages>'],
    packages: GOOGLE_TELEMETRY_PACKAGES,
    risk: 'safe',
    reversible: true,
  },
  {
    id: 'disable-tcl-ttvs',
    category: 'telemetry',
    label: 'Disable TCL TTVS Push Service',
    summary: 'Stops com.tcl.ttvs (persistent push messaging & T-Cast background service; frees ~27 MB RAM).',
    description: 'Disables com.tcl.ttvs (TTVSCore), which runs background push messaging and TCL casting services as system UID. Caution: re-enable this fix temporarily if you later want to check for official TCL OTA firmware updates or use T-Cast.',
    revertDescription: 'Re-enables com.tcl.ttvs so official TCL OTA update checks and T-Cast work again.',
    commands: [
      'pm disable-user --user 0 com.tcl.ttvs',
      'am force-stop com.tcl.ttvs',
    ],
    revertCommands: ['pm enable --user 0 com.tcl.ttvs'],
    packages: ['com.tcl.ttvs'],
    risk: 'caution',
    reversible: true,
    requiresConfirm: true,
  },
  {
    id: 'enable-adguard-dns',
    category: 'privacy',
    label: 'Enable AdGuard Private DNS',
    summary: 'Routes DNS over TLS through dns.adguard-dns.com to block tracker, telemetry, and ad domains system-wide.',
    description: 'Configures Android Private DNS in strict hostname mode using AdGuard DNS (dns.adguard-dns.com). Blocks telemetry and ad endpoints across all apps—including privileged system services—without requiring a VPN or root.',
    revertDescription: 'Restores Android Private DNS to automatic (opportunistic) mode and clears the custom DNS hostname.',
    commands: [
      'settings put global private_dns_mode hostname',
      'settings put global private_dns_specifier dns.adguard-dns.com',
    ],
    revertCommands: [
      'settings put global private_dns_mode opportunistic',
      'settings delete global private_dns_specifier',
    ],
    risk: 'safe',
    reversible: true,
  },
  {
    id: 'disable-tracking-settings',
    category: 'privacy',
    label: 'Disable Location & Activity Logging',
    summary: 'Turns off network location tracking, activity-start logging, and TCL diagnostic/UXP toggles.',
    description: 'Sets secure location_mode to 0 (Off), disables global activity_starts_logging_enabled, and forces TCL diagnostic and UXP telemetry flags to 0. Stops background network location services and usage logging without affecting streaming apps.',
    revertDescription: 'Restores default network location mode (3) and re-enables Android activity-start logging (1).',
    commands: [
      'settings put secure location_mode 0',
      'settings put global activity_starts_logging_enabled 0',
      'settings put global tcl_diagnostic_status 0',
      'settings put global tcl_uxp_status 0',
    ],
    revertCommands: [
      'settings put secure location_mode 3',
      'settings put global activity_starts_logging_enabled 1',
    ],
    risk: 'safe',
    reversible: true,
  },
  {
    id: 'disable-ambient-mode',
    category: 'performance',
    label: 'Disable Ambient Screensaver (DreamX)',
    summary: 'Disables Google TV Ambient Mode (com.google.android.apps.tv.dreamx) to reclaim ~200+ MB of RAM.',
    description: 'Disables Google TV Ambient Mode and its smarthome companion process (com.google.android.apps.tv.dreamx), which holds location access and consumes substantial RAM on 2 GB Android TVs. Apps, launcher, and playback keep working normally.',
    revertDescription: 'Re-enables com.google.android.apps.tv.dreamx to restore Google TV Ambient Mode screensaver.',
    commands: [
      'pm disable-user --user 0 com.google.android.apps.tv.dreamx',
      'am force-stop com.google.android.apps.tv.dreamx',
    ],
    revertCommands: ['pm enable --user 0 com.google.android.apps.tv.dreamx'],
    packages: ['com.google.android.apps.tv.dreamx'],
    risk: 'safe',
    reversible: true,
  },
  {
    id: 'disable-voice-assistant',
    category: 'privacy',
    label: 'Disable Google Assistant & Voice Search',
    summary: 'Disables com.google.android.katniss (stops microphone/voice background service; frees ~95 MB RAM).',
    description: 'Disables Google Assistant / TV Search (com.google.android.katniss), which holds microphone (RECORD_AUDIO), fine location, and usage-stats permissions and runs persistent background processes. Caution: voice search on the remote will stop working until re-enabled.',
    revertDescription: 'Re-enables com.google.android.katniss to restore Google Assistant and remote voice search.',
    commands: [
      'pm disable-user --user 0 com.google.android.katniss',
      'am force-stop com.google.android.katniss',
    ],
    revertCommands: ['pm enable --user 0 com.google.android.katniss'],
    packages: ['com.google.android.katniss'],
    risk: 'caution',
    reversible: true,
    requiresConfirm: true,
  },
  {
    id: 'speedup-animations',
    category: 'performance',
    label: 'Speed Up UI Animations (0.5x)',
    summary: 'Halves window, transition, and animator durations from 1.0x to 0.5x for snappier menu navigation.',
    description: 'Sets Android global window, transition, and animator duration scales to 0.5. Makes navigating menus, switching apps, and opening overlays feel noticeably faster with zero functional side effects.',
    revertDescription: 'Restores Android window, transition, and animator duration scales back to 1.0x.',
    commands: [
      'settings put global window_animation_scale 0.5',
      'settings put global transition_animation_scale 0.5',
      'settings put global animator_duration_scale 0.5',
    ],
    revertCommands: [
      'settings put global window_animation_scale 1.0',
      'settings put global transition_animation_scale 1.0',
      'settings put global animator_duration_scale 1.0',
    ],
    risk: 'safe',
    reversible: true,
  },
  {
    id: 'trim-caches-and-stop-bloat',
    category: 'maintenance',
    label: 'Trim Caches & Stop Background Bloat',
    summary: 'Reclaims app cache storage and force-stops running bloatware and 3rd-party apps to free RAM now.',
    description: 'Runs pm trim-caches across all installed packages and force-stops currently running bloatware and 3rd-party background apps to immediately reclaim RAM and /data storage without disabling any app.',
    commands: [
      'pm trim-caches 999999999999',
      'am force-stop <running bloatware & 3rd-party packages>',
    ],
    risk: 'safe',
    reversible: false,
  },
  {
    id: 'reboot-tv',
    category: 'maintenance',
    label: 'Reboot Android TV',
    summary: 'Cleanly restarts the TV so disabled background services and privacy settings take full effect.',
    description: 'Sends an ADB reboot command to restart the TV. Recommended after disabling privileged background services so lingering processes exit cleanly. The TV will temporarily disconnect for about 30–60 seconds.',
    commands: ['adb reboot'],
    risk: 'caution',
    reversible: false,
    requiresConfirm: true,
  },
];

const OPTIMIZE_FIX_MAP = new Map<TvOptimizeFixId, TvOptimizeFix>(
  TV_OPTIMIZE_FIXES.map(fix => [fix.id, fix]),
);

export function isTvOptimizeFixId(value: string): value is TvOptimizeFixId {
  return OPTIMIZE_FIX_MAP.has(value as TvOptimizeFixId);
}

const TV_BLOATWARE_PACKAGES = new Set<string>([
  ...TCL_TELEMETRY_PACKAGES,
  ...GOOGLE_TELEMETRY_PACKAGES,
  'com.google.android.apps.tv.dreamx',
  'com.google.android.music',
  'com.google.android.youtube.tvmusic',
  'com.google.android.syncadapters.calendar',
  'com.google.android.syncadapters.contacts',
  'com.netflix.ninja',
  'com.amazon.amazonvideo.livingroom',
  'com.amazon.avod.thirdpartyclient',
  'com.spotify.tv.android',
  'com.disney.disneyplus',
  'com.apple.atve.androidtv.appletv',
  'com.android.dreams.basic',
  'com.android.dreams.phototable',
  'com.android.printspooler',
  'com.android.bips',
]);

const TV_BLOATWARE_PREFIXES = [
  'com.mitv.',
  'com.xiaomi.mitv.',
  'com.sony.dtv.',
  'com.hisense.',
  'com.philips.tv.',
];

/**
 * Determine whether a package is a common Android TV optional/bloatware package.
 */
export function isTvBloatware(pkg: string): boolean {
  if (CRITICAL_PACKAGES.has(pkg) || TV_CRITICAL_PACKAGES.has(pkg)) return false;
  if (TV_BLOATWARE_PACKAGES.has(pkg)) return true;
  return TV_BLOATWARE_PREFIXES.some(prefix => pkg.startsWith(prefix));
}

/**
 * Parse CLI arguments for the TCP TV cleanup script.
 */
export function parseTvCliArgs(argv: readonly string[]): TvCleanupCliOptions {
  let rawIp = '';
  let host: string | undefined;
  let port: number | undefined;
  let uiPort = 3334;
  let backend: AdbOptions['backend'];
  let openBrowser = true;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        help = true;
        break;
      case '--no-open':
        openBrowser = false;
        break;
      case '-i':
      case '--ip': {
        const val = argv[++i];
        if (!val) throw new Error(`Missing value for ${arg}`);
        rawIp = val;
        break;
      }
      case '--host': {
        const val = argv[++i];
        if (!val) throw new Error('Missing value for --host');
        host = val;
        break;
      }
      case '--port': {
        const val = argv[++i];
        if (!val || !/^\d+$/.test(val)) throw new Error('Invalid value for --port');
        port = Number(val);
        break;
      }
      case '--ui-port':
      case '--listen-port': {
        const val = argv[++i];
        if (!val || !/^\d+$/.test(val)) throw new Error(`Invalid value for ${arg}`);
        uiPort = Number(val);
        break;
      }
      case '--backend': {
        const val = argv[++i];
        if (val !== 'auto' && val !== 'native' && val !== 'ya-webadb') {
          throw new Error(`Invalid --backend value "${val}" (expected auto, native, or ya-webadb)`);
        }
        backend = val;
        break;
      }
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!rawIp) {
          rawIp = arg;
        } else {
          throw new Error(`Unexpected positional argument: ${arg}`);
        }
        break;
    }
  }

  if (help) {
    return {
      tvIp: rawIp,
      tvHost: '',
      tvPort: 5555,
      tvSerial: '',
      host,
      port,
      uiHost: '127.0.0.1',
      uiPort,
      backend,
      openBrowser,
      help: true,
    };
  }

  if (!rawIp.trim()) {
    throw new Error('Missing TV IP address. Usage: tsx tasks/tvCleanup.ts <tv-ip[:port]>');
  }

  const parsed = parseHostPort(rawIp.trim(), 5555);
  if (!parsed.host || parsed.port < 1 || parsed.port > 65535) {
    throw new Error(`Invalid TV address: ${rawIp}`);
  }

  return {
    tvIp: rawIp.trim(),
    tvHost: parsed.host,
    tvPort: parsed.port,
    tvSerial: `${parsed.host}:${parsed.port}`,
    host,
    port,
    uiHost: '127.0.0.1',
    uiPort,
    backend,
    openBrowser,
    help: false,
  };
}

function printUsage(): void {
  console.log(`Usage: tsx tasks/tvCleanup.ts [options] <tv-ip[:port]>

Connects to an Android TV / Google TV over TCP ADB (default port 5555)
and starts a local web GUI to inspect storage/RAM, trim caches, stop running
apps, clean leftover APK/temp files, and hide/disable or uninstall bloatware.

Options:
  -i, --ip <ip[:port]>        TV IP address (can also be passed positionally)
  --ui-port <port>            Local web GUI port (default: 3334)
  --host <host>               ADB server host (default: 127.0.0.1)
  --port <port>               ADB server port (default: 5037)
  --backend <mode>            ADB backend: auto | native | ya-webadb
  --no-open                   Do not automatically open the browser
  -h, --help                  Show this help message`);
}

/**
 * Parse `df -k /data` output into byte-level storage metrics.
 */
export function parseDfOutput(raw: string): StorageStats | null {
  const lines = raw.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  // Join wrapped lines (some Android df versions wrap long filesystem names onto two lines).
  const bodyTokens = lines.slice(1).join(' ').split(/\s+/);
  for (let i = 0; i <= bodyTokens.length - 5; i++) {
    const totalKb = Number(bodyTokens[i]);
    const usedKb = Number(bodyTokens[i + 1]);
    const availKb = Number(bodyTokens[i + 2]);
    const pctRaw = bodyTokens[i + 3];
    if (
      Number.isFinite(totalKb) && totalKb > 0
      && Number.isFinite(usedKb) && usedKb >= 0
      && Number.isFinite(availKb) && availKb >= 0
      && /^\d+%$/.test(pctRaw)
    ) {
      const totalBytes = totalKb * 1024;
      const usedBytes = usedKb * 1024;
      const availableBytes = availKb * 1024;
      const usedPercent = Math.min(100, Math.max(0, Math.round((usedKb / totalKb) * 100)));
      return { totalBytes, usedBytes, availableBytes, usedPercent };
    }
  }
  return null;
}

const MEMINFO_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['MemTotal', 'Total RAM'],
  ['MemAvailable', 'Available RAM'],
  ['MemFree', 'Free RAM'],
  ['Buffers', 'Kernel Buffers'],
  ['Cached', 'Page Cache'],
  ['SwapCached', 'Swap Cache'],
  ['Active', 'Active Memory'],
  ['Inactive', 'Inactive Memory'],
  ['AnonPages', 'Anonymous Pages (Apps)'],
  ['Mapped', 'Mapped Files'],
  ['Shmem', 'Shared Memory'],
  ['Slab', 'Kernel Slab'],
  ['SReclaimable', 'Slab Reclaimable'],
  ['SUnreclaim', 'Slab Unreclaimable'],
  ['KernelStack', 'Kernel Stacks'],
  ['PageTables', 'Page Tables'],
  ['SwapTotal', 'Swap / ZRAM Total'],
  ['SwapFree', 'Swap / ZRAM Free'],
];

function parseMemInfoMap(raw: string): Map<string, number> {
  const fields = new Map<string, number>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^(\w+):\s+(\d+)\s*kB/i.exec(line.trim());
    if (match) {
      fields.set(match[1], Number(match[2]) * 1024);
    }
  }
  return fields;
}

/**
 * Parse `/proc/meminfo` output into RAM usage metrics.
 */
export function parseMemInfo(raw: string): MemoryStats | null {
  const fields = parseMemInfoMap(raw);
  const totalBytes = fields.get('MemTotal');
  if (!totalBytes || totalBytes <= 0) return null;

  const availableBytes = fields.get('MemAvailable')
    ?? ((fields.get('MemFree') ?? 0) + (fields.get('Buffers') ?? 0) + (fields.get('Cached') ?? 0));
  const clampedAvail = Math.min(totalBytes, Math.max(0, availableBytes));
  const usedBytes = totalBytes - clampedAvail;
  const usedPercent = Math.min(100, Math.max(0, Math.round((usedBytes / totalBytes) * 100)));
  return { totalBytes, usedBytes, availableBytes: clampedAvail, usedPercent };
}

/**
 * Extract detailed `/proc/meminfo` counters in display order.
 */
export function parseMemInfoDetails(raw: string): MemoryDetailItem[] {
  const fields = parseMemInfoMap(raw);
  const items: MemoryDetailItem[] = [];
  for (const [key, label] of MEMINFO_LABELS) {
    const bytes = fields.get(key);
    if (bytes !== undefined) {
      items.push({ key, label, bytes });
    }
  }
  return items;
}

function parseSizeTokenToBytes(raw?: string): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  const match = /^(\d+(?:\.\d+)?)\s*([KMGT])?$/i.exec(trimmed);
  if (!match) return 0;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) return 0;
  const unit = (match[2] || 'K').toUpperCase();
  const mult = unit === 'T'
    ? 1024 ** 4
    : unit === 'G'
      ? 1024 ** 3
      : unit === 'M'
        ? 1024 ** 2
        : 1024;
  return Math.round(num * mult);
}

/**
 * Rank running `ps` entries by resident set size (RSS) RAM usage.
 */
export function parseTopMemoryProcesses(
  psEntries: ReadonlyArray<Partial<PsEntry>>,
  limit = 20,
): ProcessMemoryEntry[] {
  const result: ProcessMemoryEntry[] = [];
  for (const entry of psEntries) {
    const name = (entry.NAME || entry.CMD || entry.ARGS || '').trim();
    const pid = (entry.PID || '').trim();
    const rssBytes = parseSizeTokenToBytes(entry.RSS ?? entry.RES);
    if (!name || rssBytes <= 0) continue;
    result.push({
      pid: pid || '—',
      name,
      user: entry.USER?.trim() || undefined,
      rssBytes,
    });
  }
  result.sort((a, b) => b.rssBytes - a.rssBytes);
  return result.slice(0, limit);
}

/**
 * Extract package names currently running from `device.getPs()` entries.
 */
export function parseRunningPackages(psEntries: ReadonlyArray<Partial<PsEntry>>): Set<string> {
  const running = new Set<string>();
  for (const entry of psEntries) {
    const name = entry.NAME?.trim();
    if (!name) continue;
    const baseName = name.split(':')[0];
    if (baseName.includes('.') && RE_PACKAGE_NAME.test(baseName)) {
      running.add(baseName);
    }
  }
  return running;
}

/**
 * Parse `ls -l` output from `/data/local/tmp` or `/sdcard/Download` for cleanable APK/tmp/log files.
 */
export function parseTempFilesOutput(raw: string, baseDir: string): TempFileEntry[] {
  const normalizedBase = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
  const files: TempFileEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('-')) continue;
    // Standard toybox `ls -l`: perms links owner group size date time name...
    const match = /^-\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/.exec(trimmed)
      ?? /^-\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w+\s+\d+\s+[\d:]+\s+(.+)$/.exec(trimmed);
    if (!match) continue;
    const sizeBytes = Number(match[1]);
    const fileName = match[2].trim();
    if (!fileName || fileName.includes('/') || fileName === '.' || fileName === '..') continue;
    if (!/\.(apk|apks|xapk|tmp|log)$/i.test(fileName)) continue;
    files.push({
      path: `${normalizedBase}${fileName}`,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    });
  }
  return files;
}

export function isAllowedTempFilePath(filePath: string): boolean {
  if (filePath.includes('..') || filePath.includes('\0')) return false;
  return ALLOWED_TEMP_PREFIXES.some((prefix) => {
    if (!filePath.startsWith(prefix)) return false;
    const rest = filePath.slice(prefix.length);
    return rest.length > 0 && !rest.includes('/');
  });
}

async function readAndroidSetting(
  device: DeviceClient,
  namespace: 'global' | 'secure',
  key: string,
): Promise<string | null> {
  try {
    const raw = await device.execOut(['settings', 'get', namespace, key], 'utf8');
    if (typeof raw !== 'string') return null;
    const val = raw.trim();
    return !val || val === 'null' ? null : val;
  } catch {
    return null;
  }
}

async function runAndroidSettingCommand(device: DeviceClient, args: readonly string[]): Promise<void> {
  const raw = await device.execOut(args, 'utf8');
  const out = typeof raw === 'string' ? raw.trim() : '';
  if (/(?:^|\n)\s*(?:Error|Exception|SecurityException|Permission Denial|Invalid|Failed)/i.test(out)) {
    throw new Error(out);
  }
}

export async function fetchTvOptimizeSettings(device: DeviceClient): Promise<TvOptimizeSettings> {
  const [
    privateDnsMode,
    privateDnsSpecifier,
    locationMode,
    activityStartsLogging,
    windowAnimationScale,
    transitionAnimationScale,
    animatorDurationScale,
    tclDiagnosticStatus,
    tclUxpStatus,
  ] = await Promise.all([
    readAndroidSetting(device, 'global', 'private_dns_mode'),
    readAndroidSetting(device, 'global', 'private_dns_specifier'),
    readAndroidSetting(device, 'secure', 'location_mode'),
    readAndroidSetting(device, 'global', 'activity_starts_logging_enabled'),
    readAndroidSetting(device, 'global', 'window_animation_scale'),
    readAndroidSetting(device, 'global', 'transition_animation_scale'),
    readAndroidSetting(device, 'global', 'animator_duration_scale'),
    readAndroidSetting(device, 'global', 'tcl_diagnostic_status'),
    readAndroidSetting(device, 'global', 'tcl_uxp_status'),
  ]);

  return {
    privateDnsMode,
    privateDnsSpecifier,
    locationMode,
    activityStartsLogging,
    windowAnimationScale,
    transitionAnimationScale,
    animatorDurationScale,
    tclDiagnosticStatus,
    tclUxpStatus,
  };
}

async function fetchTvStatus(device: DeviceClient): Promise<{
  summary: DeviceSummary;
  storage: StorageStats | null;
  memory: MemoryStats | null;
  memoryDetails: MemoryDetailItem[];
  topProcesses: ProcessMemoryEntry[];
  apps: TvAppEntry[];
  tempFiles: TempFileEntry[];
  optimizeSettings: TvOptimizeSettings;
}> {
  const [summary, dfRaw, memRaw, psEntries, baseApps, tmpLs, dlLs, optimizeSettings] = await Promise.all([
    fetchDeviceSummary(device),
    device.execOut(['df', '-k', '/data'], 'utf8').catch(() => ''),
    device.execOut(['cat', '/proc/meminfo'], 'utf8').catch(() => ''),
    device.getPs().catch(() => [] as Array<Partial<PsEntry>>),
    loadDevicePackages(device),
    device.execOut(['ls', '-l', '/data/local/tmp'], 'utf8').catch(() => ''),
    device.execOut(['ls', '-l', '/sdcard/Download'], 'utf8').catch(() => ''),
    fetchTvOptimizeSettings(device),
  ]);

  const runningSet = parseRunningPackages(psEntries);
  const apps: TvAppEntry[] = baseApps.map((app) => ({
    ...app,
    running: runningSet.has(app.name),
    suggestedBloat: isTvBloatware(app.name),
  }));

  const tempFiles = [
    ...parseTempFilesOutput(tmpLs, '/data/local/tmp'),
    ...parseTempFilesOutput(dlLs, '/sdcard/Download'),
  ];

  return {
    summary,
    storage: parseDfOutput(dfRaw),
    memory: parseMemInfo(memRaw),
    memoryDetails: parseMemInfoDetails(memRaw),
    topProcesses: parseTopMemoryProcesses(psEntries, 20),
    apps,
    tempFiles,
    optimizeSettings,
  };
}

async function trimTvCaches(device: DeviceClient): Promise<string> {
  const out = await device.execOut(['pm', 'trim-caches', '999999999999'], 'utf8');
  if (/Error|Exception|IllegalArgument/i.test(out)) {
    const fallback = await device.execOut(['cmd', 'package', 'trim-caches', '999G'], 'utf8');
    if (/Error|Exception|IllegalArgument/i.test(fallback)) {
      throw new Error(fallback.trim() || out.trim() || 'trim-caches failed');
    }
    return fallback.trim() || 'Trimmed all package caches.';
  }
  return out.trim() || 'Trimmed all package caches.';
}

async function applyPackageGroupFix(
  device: DeviceClient,
  fix: TvOptimizeFix,
  mode: TvOptimizeMode,
): Promise<TvOptimizeActionResult> {
  const targets = fix.packages ?? [];
  const installed = await loadDevicePackages(device);
  const byName = new Map(installed.map(app => [app.name, app]));

  const present = targets
    .map(pkg => byName.get(pkg))
    .filter((app): app is AppEntry => app !== undefined);

  if (present.length === 0) {
    return {
      ok: true,
      fixId: fix.id,
      mode,
      message: `No matching packages for "${fix.label}" are installed on this TV.`,
      applied: [],
      skipped: [],
      failed: [],
    };
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const app of present) {
    if (mode === 'apply') {
      if (CRITICAL_PACKAGES.has(app.name) || TV_CRITICAL_PACKAGES.has(app.name)) {
        skipped.push(app.name);
        continue;
      }
      if (app.state !== 'enabled') {
        skipped.push(app.name);
        continue;
      }
      try {
        try {
          await hidePackage(device, app.name, 'disable');
        } catch (disableErr) {
          const msg = disableErr instanceof Error ? disableErr.message : String(disableErr);
          if (/SecurityException|Permission Denial|not allowed|Cannot disable/i.test(msg)) {
            await hidePackage(device, app.name, 'auto');
          } else {
            throw disableErr;
          }
        }
        await device.execOut(['am', 'force-stop', app.name], 'utf8').catch(() => '');
        applied.push(app.name);
        console.log(`  ✓ disabled ${app.name}`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        failed.push({ name: app.name, error });
        console.log(`  ✗ ${app.name}: ${error}`);
      }
    } else {
      if (app.state === 'enabled') {
        skipped.push(app.name);
        continue;
      }
      try {
        await unhidePackage(device, app.name, app.state, 'disable');
        applied.push(app.name);
        console.log(`  ✓ re-enabled ${app.name}`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        failed.push({ name: app.name, error });
        console.log(`  ✗ ${app.name}: ${error}`);
      }
    }
  }

  const verb = mode === 'apply' ? 'Disabled' : 'Re-enabled';
  const alreadyWord = mode === 'apply' ? 'disabled' : 'enabled';
  let message: string;
  if (applied.length > 0 && failed.length === 0) {
    message = `${verb} ${applied.length} package(s)${skipped.length > 0 ? ` (${skipped.length} already ${alreadyWord})` : ''}.`;
  } else if (applied.length === 0 && failed.length === 0) {
    message = `Already up to date: all ${skipped.length} matching package(s) are ${alreadyWord}.`;
  } else if (applied.length > 0) {
    message = `${verb} ${applied.length} package(s), ${failed.length} failed (${failed[0].name}: ${failed[0].error}).`;
  } else {
    message = `Failed to update ${failed.length} package(s): ${failed[0].name}: ${failed[0].error}`;
  }

  return {
    ok: failed.length === 0,
    fixId: fix.id,
    mode,
    message,
    applied,
    skipped,
    failed,
  };
}

/**
 * Apply or revert a curated Android TV privacy/performance optimization fix.
 */
export async function applyTvOptimizeFix(
  device: DeviceClient,
  fixId: TvOptimizeFixId,
  mode: TvOptimizeMode = 'apply',
): Promise<TvOptimizeActionResult> {
  const fix = OPTIMIZE_FIX_MAP.get(fixId);
  if (!fix) {
    throw new Error(`Unknown optimization fix: ${String(fixId)}`);
  }
  if (mode === 'revert' && !fix.reversible) {
    throw new Error(`Optimization "${fix.label}" cannot be reverted automatically.`);
  }

  switch (fixId) {
    case 'disable-tcl-telemetry':
    case 'disable-google-telemetry':
    case 'disable-tcl-ttvs':
    case 'disable-ambient-mode':
    case 'disable-voice-assistant':
      return applyPackageGroupFix(device, fix, mode);

    case 'enable-adguard-dns': {
      if (mode === 'apply') {
        await runAndroidSettingCommand(device, ['settings', 'put', 'global', 'private_dns_mode', 'hostname']);
        await runAndroidSettingCommand(device, ['settings', 'put', 'global', 'private_dns_specifier', 'dns.adguard-dns.com']);
        return {
          ok: true,
          fixId,
          mode,
          message: 'Enabled AdGuard Private DNS (dns.adguard-dns.com).',
          applied: ['private_dns_mode=hostname', 'private_dns_specifier=dns.adguard-dns.com'],
          skipped: [],
          failed: [],
        };
      }
      await runAndroidSettingCommand(device, ['settings', 'put', 'global', 'private_dns_mode', 'opportunistic']);
      await runAndroidSettingCommand(device, ['settings', 'delete', 'global', 'private_dns_specifier']);
      return {
        ok: true,
        fixId,
        mode,
        message: 'Restored Private DNS to automatic (opportunistic) mode.',
        applied: ['private_dns_mode=opportunistic'],
        skipped: [],
        failed: [],
      };
    }

    case 'disable-tracking-settings': {
      if (mode === 'apply') {
        await runAndroidSettingCommand(device, ['settings', 'put', 'secure', 'location_mode', '0']);
        await runAndroidSettingCommand(device, ['settings', 'put', 'global', 'activity_starts_logging_enabled', '0']);
        await runAndroidSettingCommand(device, ['settings', 'put', 'global', 'tcl_diagnostic_status', '0']);
        await runAndroidSettingCommand(device, ['settings', 'put', 'global', 'tcl_uxp_status', '0']);
        return {
          ok: true,
          fixId,
          mode,
          message: 'Disabled location tracking, activity-start logging, and TCL diagnostic flags.',
          applied: [
            'location_mode=0',
            'activity_starts_logging_enabled=0',
            'tcl_diagnostic_status=0',
            'tcl_uxp_status=0',
          ],
          skipped: [],
          failed: [],
        };
      }
      await runAndroidSettingCommand(device, ['settings', 'put', 'secure', 'location_mode', '3']);
      await runAndroidSettingCommand(device, ['settings', 'put', 'global', 'activity_starts_logging_enabled', '1']);
      return {
        ok: true,
        fixId,
        mode,
        message: 'Restored default location mode and activity-start logging.',
        applied: ['location_mode=3', 'activity_starts_logging_enabled=1'],
        skipped: [],
        failed: [],
      };
    }

    case 'speedup-animations': {
      const scale = mode === 'apply' ? '0.5' : '1.0';
      await runAndroidSettingCommand(device, ['settings', 'put', 'global', 'window_animation_scale', scale]);
      await runAndroidSettingCommand(device, ['settings', 'put', 'global', 'transition_animation_scale', scale]);
      await runAndroidSettingCommand(device, ['settings', 'put', 'global', 'animator_duration_scale', scale]);
      return {
        ok: true,
        fixId,
        mode,
        message: mode === 'apply'
          ? 'Set UI animation scales to 0.5x for faster navigation.'
          : 'Restored UI animation scales to 1.0x.',
        applied: [
          `window_animation_scale=${scale}`,
          `transition_animation_scale=${scale}`,
          `animator_duration_scale=${scale}`,
        ],
        skipped: [],
        failed: [],
      };
    }

    case 'trim-caches-and-stop-bloat': {
      await trimTvCaches(device);
      const [apps, psEntries] = await Promise.all([
        loadDevicePackages(device),
        device.getPs().catch(() => [] as Array<Partial<PsEntry>>),
      ]);
      const runningSet = parseRunningPackages(psEntries);
      const toStop = apps
        .filter(app => runningSet.has(app.name) && (isTvBloatware(app.name) || app.kind === 'user'))
        .map(app => app.name);
      for (const pkg of toStop) {
        await device.execOut(['am', 'force-stop', pkg], 'utf8').catch(() => '');
        console.log(`  ✓ force-stopped ${pkg}`);
      }
      return {
        ok: true,
        fixId,
        mode,
        message: `Trimmed all package caches and force-stopped ${toStop.length} running bloat/3rd-party app(s).`,
        applied: ['pm trim-caches', ...toStop],
        skipped: [],
        failed: [],
      };
    }

    case 'reboot-tv': {
      await device.reboot();
      return {
        ok: true,
        fixId,
        mode,
        message: 'Reboot command sent. Wait ~30–60 seconds for the TV to restart, then click Reconnect.',
        applied: ['reboot'],
        skipped: [],
        failed: [],
        disconnected: true,
      };
    }
  }
}

/**
 * Render the TCP TV Cleanup web GUI with a per-request CSP nonce.
 */
export function renderTvCleanupPage(
  nonce: string,
  initialConfig: { tvSerial: string; tvHost: string; tvPort: number },
): string {
  const bootstrapJson = JSON.stringify({
    ...initialConfig,
    criticalPackages: [...new Set([...CRITICAL_PACKAGES, ...TV_CRITICAL_PACKAGES])],
    optimizeFixes: TV_OPTIMIZE_FIXES,
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>adbkit — Android TV Cleanup</title>
  <style nonce="${nonce}">
    :root {
      --bg-light: #f4f6fb;
      --bg-dark: #0d1219;
      --surface-light: #ffffff;
      --surface-dark: #161e29;
      --surface-alt-light: #edf1f7;
      --surface-alt-dark: #1f2a38;
      --border-light: #d3dce8;
      --border-dark: #2a374b;
      --text-light: #111824;
      --text-dark: #ebf1f8;
      --muted-light: #526175;
      --muted-dark: #9cb0c8;
      --brand-light: #1a56db;
      --brand-dark: #63a6ff;
      --brand-text-light: #ffffff;
      --brand-text-dark: #071222;
      --ok-light: #157347;
      --ok-dark: #58d398;
      --warn-light: #9a5b00;
      --warn-dark: #f7ba56;
      --danger-light: #b42318;
      --danger-dark: #ff7c73;
      --scrollbar-track-light: #e5ebf3;
      --scrollbar-track-dark: #111720;
      --scrollbar-thumb-light: #798aa2;
      --scrollbar-thumb-dark: #5c6f8b;

      --bg: var(--bg-light);
      --surface: var(--surface-light);
      --surface-alt: var(--surface-alt-light);
      --border: var(--border-light);
      --text: var(--text-light);
      --muted: var(--muted-light);
      --brand: var(--brand-light);
      --brand-text: var(--brand-text-light);
      --ok: var(--ok-light);
      --warn: var(--warn-light);
      --danger: var(--danger-light);
      --scrollbar-track: var(--scrollbar-track-light);
      --scrollbar-thumb: var(--scrollbar-thumb-light);

      @media (prefers-color-scheme: dark) {
        --bg: var(--bg-dark);
        --surface: var(--surface-dark);
        --surface-alt: var(--surface-alt-dark);
        --border: var(--border-dark);
        --text: var(--text-dark);
        --muted: var(--muted-dark);
        --brand: var(--brand-dark);
        --brand-text: var(--brand-text-dark);
        --ok: var(--ok-dark);
        --warn: var(--warn-dark);
        --danger: var(--danger-dark);
        --scrollbar-track: var(--scrollbar-track-dark);
        --scrollbar-thumb: var(--scrollbar-thumb-dark);
      }

      @supports (color: light-dark(white, black)) {
        --bg: light-dark(var(--bg-light), var(--bg-dark));
        --surface: light-dark(var(--surface-light), var(--surface-dark));
        --surface-alt: light-dark(var(--surface-alt-light), var(--surface-alt-dark));
        --border: light-dark(var(--border-light), var(--border-dark));
        --text: light-dark(var(--text-light), var(--text-dark));
        --muted: light-dark(var(--muted-light), var(--muted-dark));
        --brand: light-dark(var(--brand-light), var(--brand-dark));
        --brand-text: light-dark(var(--brand-text-light), var(--brand-text-dark));
        --ok: light-dark(var(--ok-light), var(--ok-dark));
        --warn: light-dark(var(--warn-light), var(--warn-dark));
        --danger: light-dark(var(--danger-light), var(--danger-dark));
        --scrollbar-track: light-dark(var(--scrollbar-track-light), var(--scrollbar-track-dark));
        --scrollbar-thumb: light-dark(var(--scrollbar-thumb-light), var(--scrollbar-thumb-dark));
      }

      color-scheme: light dark;
      accent-color: var(--brand);
      scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.45;
    }

    .shell {
      max-inline-size: 1220px;
      margin-inline: auto;
      padding: 1.25rem;
      display: grid;
      gap: 1rem;
    }

    header, .card, .toolbar {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.2rem;
    }

    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    header > div {
      min-inline-size: 0;
    }

    h1 {
      margin: 0;
      font-size: 1.25rem;
      line-height: 1.2;
    }

    .subtitle {
      margin: 0.25rem 0 0;
      color: var(--muted);
      font-size: 0.9rem;
    }

    .arch-meta {
      margin: 0.45rem 0 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.82rem;
      color: var(--muted);
    }

    .arch-meta[hidden] {
      display: none;
    }

    .abi-chip {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.78rem;
      color: var(--text);
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.1rem 0.45rem;
    }

    .abi-chip.primary {
      border-color: var(--brand);
      font-weight: 700;
    }

    .connect-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }

    label {
      font-size: 0.85rem;
      color: var(--muted);
      font-weight: 600;
    }

    input, select, button {
      font: inherit;
      color: inherit;
    }

    input[type="search"],
    input[type="text"],
    select {
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.45rem 0.65rem;
      min-block-size: 2.25rem;
    }

    button {
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.45rem 0.85rem;
      min-block-size: 2.25rem;
      font-weight: 600;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      border-color: var(--brand);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.primary {
      background: var(--brand);
      border-color: var(--brand);
      color: var(--brand-text);
    }

    button.danger {
      border-color: var(--danger);
      color: var(--danger);
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 0.85rem;
    }

    .metric-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.9rem 1rem;
      display: grid;
      gap: 0.45rem;
    }

    .metric-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.5rem;
    }

    .metric-title {
      font-size: 0.85rem;
      color: var(--muted);
      font-weight: 600;
    }

    .metric-value {
      font-size: 1.1rem;
      font-weight: 700;
    }

    .metric-sub {
      font-size: 0.82rem;
      color: var(--muted);
    }

    progress {
      appearance: none;
      border: 0 solid;
      overflow: clip;
      inline-size: 100%;
      block-size: 0.6rem;
      --progress-bar-radius: 1e5px;
      border-radius: var(--progress-bar-radius);
      background: var(--surface-alt);
      box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.15);
      container-type: inline-size;
      --progress-bar-indeterminate-size: 30%;
      --progress-bar-indeterminate-animation-duration: 1.5s;
      --progress-bar-fill: var(--brand);

      @media (prefers-reduced-motion: reduce) {
        --progress-bar-indeterminate-animation-duration: 10s;
      }
    }

    progress::-webkit-progress-bar {
      background: transparent;
    }

    progress::-webkit-progress-value {
      background: var(--progress-bar-fill);
      border-radius: var(--progress-bar-radius);
      transition: inline-size 0.3s;
      animation: var(--progress-bar-animation, revert-rule);
    }

    progress::-moz-progress-bar {
      background: var(--progress-bar-fill);
      border-radius: var(--progress-bar-radius);
      transition: inline-size 0.3s;
      animation: var(--progress-bar-animation, revert-rule);
    }

    progress:indeterminate {
      --progress-bar-animation: progress-bar-indeterminate var(--progress-bar-indeterminate-animation-duration) infinite linear;
    }

    @keyframes progress-bar-indeterminate {
      from, to {
        inline-size: var(--progress-bar-indeterminate-size);
        margin-right: auto;
      }
      from { translate: -100%; }
      to { translate: 100cqi; }
    }

    .cleanup-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
      align-items: center;
    }

    .toolbar {
      display: grid;
      gap: 0.85rem;
    }

    search form {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: end;
    }

    .field {
      display: grid;
      gap: 0.3rem;
      flex: 1 1 180px;
    }

    .field.grow {
      flex: 2 1 250px;
    }

    .batch-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding-block-start: 0.75rem;
      border-top: 1px solid var(--border);
    }

    .batch-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .status-banner {
      background: var(--surface);
      border: 1px solid var(--border);
      border-left-width: 4px;
      border-radius: 8px;
      padding: 0.65rem 0.9rem;
      font-size: 0.92rem;
    }

    .status-banner[data-kind="success"] { border-left-color: var(--ok); }
    .status-banner[data-kind="error"] { border-left-color: var(--danger); }
    .status-banner[data-kind="warn"] { border-left-color: var(--warn); }
    .status-banner[data-kind="info"] { border-left-color: var(--brand); }

    .temp-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      align-items: center;
      font-size: 0.85rem;
      color: var(--muted);
    }

    .temp-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.12rem 0.25rem 0.12rem 0.6rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      color: var(--text);
    }

    .temp-chip .chip-delete-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-block-size: 1.3rem;
      min-inline-size: 1.3rem;
      padding: 0.12rem;
      border-radius: 999px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      line-height: 1;
    }

    .temp-chip .chip-delete-btn:hover:not(:disabled),
    .temp-chip .chip-delete-btn:focus-visible {
      color: var(--danger);
      border-color: var(--danger);
      background: color-mix(in srgb, var(--danger) 12%, transparent);
    }

    .table-wrapper {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: auto;
      max-inline-size: 100%;
      max-block-size: min(600px, 65vh);
      container-type: inline-size;
    }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      --label-1: "Select";
      --label-2: "Application";
      --label-3: "Version";
      --label-4: "Flags";
      --label-5: "Status";
      --label-6: "Actions";
    }

    .version-cell {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .app-version {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.84rem;
    }

    .app-version[data-empty="true"] {
      color: var(--muted);
    }

    .app-version-code {
      font-size: 0.78rem;
      color: var(--muted);
    }

    caption {
      text-align: start;
      padding: 0.75rem 1rem;
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }

    thead {
      position: sticky;
      inset-block-start: 0;
      z-index: 2;
      background: var(--surface-alt);
    }

    th, td {
      padding: 0.65rem 0.85rem;
      border-bottom: 1px solid var(--border);
      text-align: start;
      vertical-align: middle;
    }

    tbody th {
      position: sticky;
      inset-inline-start: 0;
      z-index: 1;
      background: var(--surface);
      max-inline-size: 420px;
    }

    tbody tr:hover td,
    tbody tr:hover th {
      background: var(--surface-alt);
    }

    .app-cell {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      min-inline-size: 0;
    }

    .app-icon,
    .app-icon-fallback {
      inline-size: 32px;
      block-size: 32px;
      flex: 0 0 32px;
      border-radius: 8px;
    }

    .app-icon {
      object-fit: contain;
      background: var(--surface-alt);
    }

    .app-icon-fallback {
      display: grid;
      place-items: center;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      color: var(--muted);
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
    }

    .app-names {
      min-inline-size: 0;
      display: grid;
      gap: 0.1rem;
    }

    .app-label {
      font-size: 0.93rem;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .app-pkg {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.77rem;
      font-weight: 400;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }

    .badge {
      display: inline-block;
      padding: 0.12rem 0.5rem;
      border-radius: 999px;
      font-size: 0.76rem;
      font-weight: 700;
      border: 1px solid currentColor;
      white-space: nowrap;
    }

    .badge[data-state="enabled"] { color: var(--ok); }
    .badge[data-state="disabled"] { color: var(--warn); }
    .badge[data-state="hidden"] { color: var(--danger); }
    .badge[data-kind="user"] { color: var(--brand); }
    .badge[data-kind="system"] { color: var(--muted); }
    .badge[data-kind="launcher"] { color: var(--ok); }
    .badge[data-kind="running"] { color: var(--warn); }
    .badge[data-kind="bloat"] { color: var(--danger); }

    .row-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .row-actions button {
      padding: 0.3rem 0.65rem;
      min-block-size: 1.95rem;
      font-size: 0.84rem;
    }

    .empty-cell {
      text-align: center;
      padding: 2rem 1rem;
      color: var(--muted);
    }

    @container (width < 680px) {
      table, thead, tbody, tr, th, td {
        display: block;
      }

      thead {
        display: none;
      }

      tr {
        margin: 0.75rem;
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
      }

      tbody th {
        position: sticky;
        inset-block-start: 0;
        z-index: 2;
        max-inline-size: none;
        background: var(--surface-alt);
      }

      td {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
      }

      td:nth-child(1)::before { content: var(--label-1) ": "; color: var(--muted); font-weight: 600; }
      td:nth-child(3)::before { content: var(--label-3) ": "; color: var(--muted); font-weight: 600; }
      td:nth-child(4)::before { content: var(--label-4) ": "; color: var(--muted); font-weight: 600; }
      td:nth-child(5)::before { content: var(--label-5) ": "; color: var(--muted); font-weight: 600; }
      td:nth-child(6)::before { content: var(--label-6) ": "; color: var(--muted); font-weight: 600; }
    }

    dialog[open] {
      display: grid;
      gap: 1rem;
      max-inline-size: min(460px, 92vw);
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
    }

    dialog:modal {
      overscroll-behavior: contain;
    }

    dialog::backdrop {
      background: rgb(0 0 0 / 55%);
      overflow: hidden;
      overscroll-behavior: contain;
    }

    dialog h2 {
      margin: 0;
      font-size: 1.1rem;
    }

    dialog p {
      margin: 0;
      color: var(--muted);
    }

    dialog form {
      display: flex;
      justify-content: flex-end;
      gap: 0.6rem;
    }

    .metric-actions {
      display: flex;
      justify-content: flex-start;
      margin-block-start: 0.15rem;
    }

    .compact-btn {
      padding: 0.3rem 0.65rem;
      min-block-size: 1.95rem;
      font-size: 0.84rem;
    }

    #memory-dialog[open] {
      max-inline-size: min(680px, 94vw);
      inline-size: 100%;
      max-block-size: min(84vh, 760px);
      overflow: auto;
    }

    .mem-section-title {
      margin: 0;
      font-size: 0.88rem;
      color: var(--muted);
      font-weight: 700;
    }

    .mem-dl {
      margin: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 0.5rem;
    }

    .mem-stat {
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.5rem 0.65rem;
      display: grid;
      gap: 0.15rem;
    }

    .mem-stat dt {
      font-size: 0.78rem;
      color: var(--muted);
    }

    .mem-stat dd {
      margin: 0;
      font-weight: 700;
      font-size: 0.92rem;
      font-variant-numeric: tabular-nums;
    }

    .mem-proc-wrap {
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: auto;
      max-block-size: 260px;
    }

    .mem-proc-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }

    .mem-proc-table th,
    .mem-proc-table td {
      padding: 0.45rem 0.65rem;
      border-bottom: 1px solid var(--border);
      text-align: start;
      position: static;
      background: transparent;
    }

    .mem-proc-table thead th {
      background: var(--surface-alt);
      position: sticky;
      inset-block-start: 0;
    }

    .mem-num {
      text-align: end;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    #remote-dialog[open] {
      max-inline-size: min(440px, 94vw);
      inline-size: 100%;
      max-block-size: min(88vh, 760px);
      overflow: auto;
      gap: 0.85rem;
    }

    .remote-group {
      display: grid;
      gap: 0.45rem;
    }

    .remote-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.45rem;
    }

    .remote-row button {
      flex: 1 1 0;
      min-inline-size: 4.5rem;
      padding: 0.4rem 0.55rem;
      font-size: 0.84rem;
    }

    .dpad-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(64px, 88px));
      justify-content: center;
      gap: 0.45rem;
    }

    .dpad-grid button {
      min-block-size: 2.75rem;
      font-size: 0.9rem;
    }

    .dpad-up { grid-column: 2; grid-row: 1; }
    .dpad-left { grid-column: 1; grid-row: 2; }
    .dpad-ok { grid-column: 2; grid-row: 2; }
    .dpad-right { grid-column: 3; grid-row: 2; }
    .dpad-down { grid-column: 2; grid-row: 3; }

    #remote-text-form {
      justify-content: stretch;
      align-items: center;
    }

    #remote-text-input {
      flex: 1;
      min-inline-size: 0;
    }

    .remote-feedback {
      font-size: 0.82rem;
      color: var(--muted);
    }

    #optimize-dialog[open] {
      max-inline-size: min(760px, 95vw);
      inline-size: 100%;
      max-block-size: min(88vh, 840px);
      overflow: auto;
      gap: 0.85rem;
    }

    .opt-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: center;
    }

    .opt-filter-btn {
      padding: 0.3rem 0.7rem;
      min-block-size: 2rem;
      font-size: 0.82rem;
      border-radius: 999px;
    }

    .opt-filter-btn[aria-pressed="true"] {
      background: var(--brand);
      border-color: var(--brand);
      color: var(--brand-text);
    }

    .opt-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.7rem;
    }

    .opt-item {
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.8rem 0.9rem;
      display: grid;
      gap: 0.5rem;
    }

    .opt-item-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.6rem;
    }

    .opt-item-title-wrap {
      display: grid;
      gap: 0.3rem;
      flex: 1 1 260px;
      min-inline-size: 0;
    }

    .opt-item-title {
      font-size: 0.96rem;
      font-weight: 700;
      color: var(--text);
    }

    .opt-item-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem;
    }

    .opt-item-desc {
      margin: 0;
      font-size: 0.87rem;
      color: var(--text);
      line-height: 1.45;
    }

    .badge[data-opt-status="applied"] { color: var(--ok); }
    .badge[data-opt-status="available"] { color: var(--brand); }
    .badge[data-opt-status="partial"] { color: var(--warn); }
    .badge[data-opt-status="na"] { color: var(--muted); }
    .badge[data-opt-risk="caution"] { color: var(--warn); }
    .badge[data-opt-risk="safe"] { color: var(--ok); }

    .opt-details {
      border-top: 1px solid var(--border);
      padding-block-start: 0.45rem;
      font-size: 0.83rem;
    }

    .opt-details > summary {
      list-style: none;
      display: inline-flex;
      align-items: center;
      gap: 0.45ch;
      cursor: pointer;
      font-weight: 600;
      color: var(--muted);
      min-block-size: 1.75rem;
    }

    .opt-details > summary::-webkit-details-marker {
      display: none;
    }

    .opt-details > summary::before {
      content: "";
      inline-size: 0.55em;
      block-size: 0.55em;
      flex-shrink: 0;
      border-inline-end: 2px solid currentColor;
      border-block-end: 2px solid currentColor;
      rotate: -45deg;
      transform-origin: center;
    }

    .opt-details > summary:dir(rtl)::before {
      rotate: 135deg;
    }

    .opt-details[open] > summary::before {
      rotate: 45deg;
    }

    @media (prefers-reduced-motion: no-preference) {
      .opt-details > summary::before {
        transition: rotate 0.2s;
      }

      .opt-details::details-content {
        transition: block-size 0.25s ease-in-out, content-visibility 0.25s ease-in-out, display 0.25s ease-in-out;
        transition-behavior: allow-discrete;
      }
    }

    .opt-details::details-content {
      interpolate-size: allow-keywords;
      overflow: clip;
      contain: layout;
    }

    .opt-details:not([open])::details-content {
      block-size: 0;
    }

    .opt-details-body {
      display: grid;
      gap: 0.45rem;
      padding-block-start: 0.45rem;
    }

    .opt-cmd-list {
      margin: 0;
      padding-inline-start: 1.1rem;
      display: grid;
      gap: 0.2rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.78rem;
      color: var(--text);
    }

    .opt-pkg-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }

    .opt-pkg-chip {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.75rem;
      padding: 0.1rem 0.45rem;
      border-radius: 6px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
    }

    .opt-pkg-chip[data-state="disabled"],
    .opt-pkg-chip[data-state="hidden"] {
      color: var(--ok);
      border-color: var(--ok);
    }

    .opt-inspector {
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-left: 4px solid var(--brand);
      border-radius: 8px;
      padding: 0.65rem 0.8rem;
      display: grid;
      gap: 0.2rem;
      font-size: 0.84rem;
    }

    .opt-inspector-title {
      font-weight: 700;
      color: var(--text);
    }

    .opt-inspector-body {
      color: var(--muted);
    }

    .opt-footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
    }

    .opt-feedback {
      margin: 0;
      font-size: 0.85rem;
      color: var(--muted);
      flex: 1 1 240px;
    }

    .opt-feedback[data-kind="success"] { color: var(--ok); }
    .opt-feedback[data-kind="error"] { color: var(--danger); }
    .opt-feedback[data-kind="warn"] { color: var(--warn); }

${APK_DROPZONE_CSS}
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div>
        <h1>adbkit — Android TV Cleanup</h1>
        <p class="subtitle" id="tv-meta">Connecting to TV…</p>
        <p class="arch-meta" id="tv-arch" hidden></p>
      </div>
      <form class="connect-bar" id="connect-form">
        <label for="tv-ip-input">TV IP</label>
        <input type="text" id="tv-ip-input" placeholder="192.168.1.50:5555">
        <button type="submit">Reconnect</button>
        <button type="button" id="refresh-btn">Refresh</button>
        <button type="button" id="optimize-btn" class="primary" command="show-modal" commandfor="optimize-dialog">Optimize</button>
        <button type="button" id="remote-btn">TV Remote</button>
      </form>
    </header>

    <section class="metrics-grid" aria-label="TV health and storage">
      <div class="metric-card">
        <div class="metric-head">
          <span class="metric-title">Internal Storage (/data)</span>
          <span class="metric-value" id="storage-pct">—</span>
        </div>
        <progress id="storage-progress" max="100"></progress>
        <span class="metric-sub" id="storage-sub">Reading storage…</span>
      </div>
      <div class="metric-card">
        <div class="metric-head">
          <span class="metric-title">Memory (RAM)</span>
          <span class="metric-value" id="memory-pct">—</span>
        </div>
        <progress id="memory-progress" max="100"></progress>
        <span class="metric-sub" id="memory-sub">Reading memory…</span>
        <div class="metric-actions">
          <button type="button" id="memory-details-btn" class="compact-btn" disabled>Memory details</button>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-head">
          <span class="metric-title">Quick TV Cleanup</span>
          <span class="metric-value" id="apps-count">0 apps</span>
        </div>
        <div class="cleanup-actions">
          <button type="button" id="trim-caches-btn" class="primary">Trim All Caches</button>
          <button type="button" id="stop-user-btn">Stop Running 3rd-Party</button>
          <button type="button" id="clean-temp-btn" class="danger" disabled>Clean Temp Files (0)</button>
        </div>
        <div class="temp-list" id="temp-list"></div>
      </div>
    </section>

    <section class="toolbar" aria-label="Filters and batch actions">
      <search>
        <form id="filter-form">
          <div class="field grow">
            <label for="search-input">Search TV apps</label>
            <input type="search" id="search-input" placeholder="Search by app name or package ID…">
          </div>
          <div class="field">
            <label for="filter-select">Filter</label>
            <select id="filter-select">
              <option value="all">All packages</option>
              <option value="bloat">Suggested TV bloatware</option>
              <option value="running">Running now</option>
              <option value="launcher">Visible in launcher</option>
              <option value="user">3rd-party only</option>
              <option value="system">System only</option>
              <option value="inactive">Hidden / Disabled</option>
            </select>
          </div>
          <div class="field">
            <label for="method-select">Hide method</label>
            <select id="method-select">
              <option value="auto">auto (hide → disable-user → uninstall -k --user 0)</option>
              <option value="hide">pm hide</option>
              <option value="disable">pm disable-user</option>
              <option value="uninstall">pm uninstall -k --user 0</option>
            </select>
          </div>
        </form>
      </search>

      <div class="batch-bar">
        <span id="selection-summary">0 selected • 0 shown</span>
        <div class="batch-buttons">
          <button type="button" id="stop-selected-btn" disabled>Force Stop (0)</button>
          <button type="button" id="hide-selected-btn" class="danger" disabled>Hide selected (0)</button>
          <button type="button" id="unhide-selected-btn" class="primary" disabled>Unhide selected (0)</button>
          <button type="button" id="uninstall-selected-btn" class="danger" disabled>Uninstall selected (0)</button>
          <button type="button" id="clear-selected-btn" disabled>Clear</button>
        </div>
      </div>
    </section>

${renderApkDropzoneHtml()}

    <div class="status-banner" id="status-banner" data-kind="info" role="status" aria-live="polite">
      Connecting to TV…
    </div>

    <main>
      <div tabindex="0" role="region" aria-labelledby="tv-apps-caption" class="table-wrapper">
        <table>
          <caption id="tv-apps-caption">Android TV applications</caption>
          <thead>
            <tr>
              <th><input type="checkbox" id="select-all-cb" aria-label="Select all visible applications"></th>
              <th>Application</th>
              <th>Version</th>
              <th>Flags</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="apps-tbody">
            <tr><td colspan="6" class="empty-cell">Loading TV packages…</td></tr>
          </tbody>
        </table>
      </div>
    </main>
  </div>

  <dialog id="confirm-dialog" closedby="any" aria-labelledby="confirm-title">
    <h2 id="confirm-title">Confirm cleanup action</h2>
    <p id="confirm-body"></p>
    <form method="dialog">
      <button value="cancel" autofocus>Cancel</button>
      <button value="confirm" class="primary">Confirm</button>
    </form>
  </dialog>

  <dialog id="memory-dialog" closedby="any" aria-labelledby="memory-dialog-title">
    <h2 id="memory-dialog-title">Memory (RAM) usage details</h2>
    <p id="memory-dialog-summary">RAM statistics from /proc/meminfo and running processes.</p>
    <h3 class="mem-section-title">Kernel &amp; system memory breakdown</h3>
    <dl class="mem-dl" id="memory-details-list"></dl>
    <h3 class="mem-section-title">Top processes by RSS RAM</h3>
    <div class="mem-proc-wrap" tabindex="0" role="region" aria-label="Top processes by RAM">
      <table class="mem-proc-table">
        <thead>
          <tr>
            <th>Process</th>
            <th>PID</th>
            <th class="mem-num">RSS</th>
          </tr>
        </thead>
        <tbody id="memory-procs-tbody"></tbody>
      </table>
    </div>
    <form method="dialog">
      <button value="close" autofocus>Close</button>
    </form>
  </dialog>

  <dialog id="remote-dialog" closedby="any" aria-labelledby="remote-dialog-title">
    <h2 id="remote-dialog-title">TV Remote Control</h2>
    <p id="remote-target-label">Connected to TV</p>

    <div class="remote-row" role="group" aria-label="Power and system">
      <button type="button" class="danger" data-remote-key="power" title="Toggle TV power">Power</button>
      <button type="button" data-remote-key="wakeup" title="Wake TV">Wake</button>
      <button type="button" data-remote-key="sleep" title="Sleep TV">Sleep</button>
      <button type="button" data-remote-key="settings" title="Open Android settings">Settings</button>
    </div>

    <div class="dpad-grid" role="group" aria-label="Directional navigation">
      <button type="button" class="dpad-up" data-remote-key="up" aria-label="Up" title="Up (ArrowUp)">▲</button>
      <button type="button" class="dpad-left" data-remote-key="left" aria-label="Left" title="Left (ArrowLeft)">◀</button>
      <button type="button" class="dpad-ok primary" data-remote-key="center" id="remote-ok-btn" autofocus>OK</button>
      <button type="button" class="dpad-right" data-remote-key="right" aria-label="Right" title="Right (ArrowRight)">▶</button>
      <button type="button" class="dpad-down" data-remote-key="down" aria-label="Down" title="Down (ArrowDown)">▼</button>
    </div>

    <div class="remote-row" role="group" aria-label="TV navigation">
      <button type="button" data-remote-key="back" title="Back (Backspace)">Back</button>
      <button type="button" data-remote-key="home" title="Home">Home</button>
      <button type="button" data-remote-key="menu" title="Menu">Menu</button>
      <button type="button" data-remote-key="info" title="Info">Info</button>
    </div>

    <div class="remote-row" role="group" aria-label="Volume and channels">
      <button type="button" data-remote-key="vol-down">Vol −</button>
      <button type="button" data-remote-key="mute">Mute</button>
      <button type="button" data-remote-key="vol-up">Vol +</button>
      <button type="button" data-remote-key="ch-down">CH −</button>
      <button type="button" data-remote-key="ch-up">CH +</button>
    </div>

    <div class="remote-row" role="group" aria-label="Media playback">
      <button type="button" data-remote-key="rewind">⏪ Rew</button>
      <button type="button" data-remote-key="play-pause">⏯ Play/Pause</button>
      <button type="button" data-remote-key="fast-forward">⏩ Fwd</button>
      <button type="button" data-remote-key="prev">⏮ Prev</button>
      <button type="button" data-remote-key="stop">⏹ Stop</button>
      <button type="button" data-remote-key="next">⏭ Next</button>
    </div>

    <form id="remote-text-form">
      <label for="remote-text-input" class="visually-hidden">Send text to TV</label>
      <input type="text" id="remote-text-input" placeholder="Send text to active TV input…" maxlength="500">
      <button type="submit">Send</button>
    </form>

    <p class="remote-feedback" id="remote-feedback" role="status" aria-live="polite">
      Tip: Arrow keys control D-Pad, Backspace goes Back.
    </p>

    <form method="dialog">
      <button value="close">Close</button>
    </form>
  </dialog>

  <dialog id="optimize-dialog" closedby="any" aria-labelledby="optimize-dialog-title">
    <h2 id="optimize-dialog-title">Optimize Android TV</h2>
    <p id="optimize-dialog-summary">Apply reversible privacy, telemetry, and performance fixes. Hover, focus, or expand any fix to review its exact action and ADB commands.</p>

    <div class="opt-filters" id="optimize-filters" role="group" aria-label="Filter optimizations by category">
      <button type="button" class="opt-filter-btn" data-opt-cat="all" aria-pressed="true">All fixes</button>
      <button type="button" class="opt-filter-btn" data-opt-cat="telemetry" aria-pressed="false">Telemetry</button>
      <button type="button" class="opt-filter-btn" data-opt-cat="privacy" aria-pressed="false">Privacy</button>
      <button type="button" class="opt-filter-btn" data-opt-cat="performance" aria-pressed="false">Performance</button>
      <button type="button" class="opt-filter-btn" data-opt-cat="maintenance" aria-pressed="false">Maintenance</button>
    </div>

    <div class="opt-inspector" id="optimize-inspector" aria-live="off">
      <span class="opt-inspector-title" id="optimize-inspector-title">Action preview</span>
      <span class="opt-inspector-body" id="optimize-inspector-body">Focus or hover any Apply or Undo button below to preview the exact action it performs.</span>
    </div>

    <ul class="opt-list" id="optimize-list" role="list"></ul>

    <div class="opt-footer">
      <p class="opt-feedback" id="optimize-feedback" data-kind="info" role="status" aria-live="polite">
        All package disables use pm disable-user --user 0 and can be undone at any time.
      </p>
      <button type="button" id="optimize-close-btn" command="close" commandfor="optimize-dialog" autofocus>Close</button>
    </div>
  </dialog>

  <script nonce="${nonce}">
    (() => {
      const INITIAL = ${bootstrapJson};
      const criticalSet = new Set(INITIAL.criticalPackages);
      const optimizeFixes = Array.isArray(INITIAL.optimizeFixes) ? INITIAL.optimizeFixes : [];
      const state = {
        serial: INITIAL.tvSerial,
        apps: [],
        filtered: [],
        tempFiles: [],
        memory: null,
        memoryDetails: [],
        topProcesses: [],
        optimizeSettings: null,
        optimizeCategory: 'all',
        selected: new Set(),
        metaLoaded: new Set(),
        metaRunId: 0,
        rowRefs: new Map(),
        busy: false,
      };

      const tvMeta = document.getElementById('tv-meta');
      const tvArch = document.getElementById('tv-arch');
      const connectForm = document.getElementById('connect-form');
      const tvIpInput = document.getElementById('tv-ip-input');
      const refreshBtn = document.getElementById('refresh-btn');
      const optimizeBtn = document.getElementById('optimize-btn');
      const optimizeDialog = document.getElementById('optimize-dialog');
      const optimizeDialogSummary = document.getElementById('optimize-dialog-summary');
      const optimizeFilters = document.getElementById('optimize-filters');
      const optimizeInspectorTitle = document.getElementById('optimize-inspector-title');
      const optimizeInspectorBody = document.getElementById('optimize-inspector-body');
      const optimizeList = document.getElementById('optimize-list');
      const optimizeFeedback = document.getElementById('optimize-feedback');
      const optimizeCloseBtn = document.getElementById('optimize-close-btn');
      const remoteBtn = document.getElementById('remote-btn');
      const remoteDialog = document.getElementById('remote-dialog');
      const remoteTargetLabel = document.getElementById('remote-target-label');
      const remoteFeedback = document.getElementById('remote-feedback');
      const remoteTextForm = document.getElementById('remote-text-form');
      const remoteTextInput = document.getElementById('remote-text-input');
      const storagePct = document.getElementById('storage-pct');
      const storageProgress = document.getElementById('storage-progress');
      const storageSub = document.getElementById('storage-sub');
      const memoryPct = document.getElementById('memory-pct');
      const memoryProgress = document.getElementById('memory-progress');
      const memorySub = document.getElementById('memory-sub');
      const memoryDetailsBtn = document.getElementById('memory-details-btn');
      const memoryDialog = document.getElementById('memory-dialog');
      const memoryDialogSummary = document.getElementById('memory-dialog-summary');
      const memoryDetailsList = document.getElementById('memory-details-list');
      const memoryProcsTbody = document.getElementById('memory-procs-tbody');
      const appsCount = document.getElementById('apps-count');
      const trimCachesBtn = document.getElementById('trim-caches-btn');
      const stopUserBtn = document.getElementById('stop-user-btn');
      const cleanTempBtn = document.getElementById('clean-temp-btn');
      const tempList = document.getElementById('temp-list');
      const filterForm = document.getElementById('filter-form');
      const searchInput = document.getElementById('search-input');
      const filterSelect = document.getElementById('filter-select');
      const methodSelect = document.getElementById('method-select');
      const selectionSummary = document.getElementById('selection-summary');
      const selectAllCb = document.getElementById('select-all-cb');
      const stopSelectedBtn = document.getElementById('stop-selected-btn');
      const hideSelectedBtn = document.getElementById('hide-selected-btn');
      const unhideSelectedBtn = document.getElementById('unhide-selected-btn');
      const uninstallSelectedBtn = document.getElementById('uninstall-selected-btn');
      const clearSelectedBtn = document.getElementById('clear-selected-btn');
      const statusBanner = document.getElementById('status-banner');
      const tbody = document.getElementById('apps-tbody');
      const confirmDialog = document.getElementById('confirm-dialog');
      const confirmTitle = document.getElementById('confirm-title');
      const confirmBody = document.getElementById('confirm-body');

      tvIpInput.value = INITIAL.tvSerial;

      function wireDialogLightDismiss(dialog) {
        if ('closedBy' in HTMLDialogElement.prototype) return;
        const outside = (e) => {
          const r = dialog.getBoundingClientRect();
          return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        };
        let pressedOutside = false;
        dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e); });
        dialog.addEventListener('pointerup', (e) => {
          if (pressedOutside && outside(e)) dialog.close();
        });
      }

      wireDialogLightDismiss(confirmDialog);
      wireDialogLightDismiss(memoryDialog);
      wireDialogLightDismiss(remoteDialog);
      wireDialogLightDismiss(optimizeDialog);

      function fmtBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return (bytes / (1024 ** exp)).toFixed(exp === 0 ? 0 : 1) + ' ' + units[exp];
      }

      function renderTvArch(summary) {
        tvArch.replaceChildren();
        const abiList = summary && Array.isArray(summary.abiList) ? summary.abiList : [];
        const primary = (summary && summary.abi) || abiList[0] || '';
        if (!primary && abiList.length === 0) {
          tvArch.hidden = true;
          return;
        }
        const label = document.createElement('span');
        label.textContent = 'CPU / APK ABI:';
        tvArch.appendChild(label);

        const abis = abiList.length > 0 ? abiList : [primary];
        abis.forEach((abi, idx) => {
          const code = document.createElement('code');
          code.className = idx === 0 ? 'abi-chip primary' : 'abi-chip';
          code.textContent = idx === 0 && abis.length > 1 ? abi + ' (primary)' : abi;
          tvArch.appendChild(code);
        });
        tvArch.hidden = false;
      }

      function setStatus(msg, kind = 'info') {
        statusBanner.textContent = msg;
        statusBanner.dataset.kind = kind;
      }

      function askConfirmation(title, body) {
        confirmTitle.textContent = title;
        confirmBody.textContent = body;
        return new Promise((resolve) => {
          confirmDialog.addEventListener('close', () => {
            const ok = confirmDialog.returnValue === 'confirm';
            confirmDialog.returnValue = '';
            resolve(ok);
          }, { once: true });
          confirmDialog.showModal();
        });
      }

      function updateMetrics(data) {
        if (data.storage) {
          storagePct.textContent = data.storage.usedPercent + '%';
          storageProgress.value = data.storage.usedPercent;
          storageSub.textContent = fmtBytes(data.storage.usedBytes) + ' used • ' + fmtBytes(data.storage.availableBytes) + ' free of ' + fmtBytes(data.storage.totalBytes);
        } else {
          storagePct.textContent = 'N/A';
          storageProgress.removeAttribute('value');
          storageSub.textContent = 'Storage stats unavailable';
        }

        state.memory = data.memory || null;
        state.memoryDetails = Array.isArray(data.memoryDetails) ? data.memoryDetails : [];
        state.topProcesses = Array.isArray(data.topProcesses) ? data.topProcesses : [];
        if (data.memory) {
          memoryPct.textContent = data.memory.usedPercent + '%';
          memoryProgress.value = data.memory.usedPercent;
          memorySub.textContent = fmtBytes(data.memory.usedBytes) + ' used • ' + fmtBytes(data.memory.availableBytes) + ' available';
          memoryDetailsBtn.disabled = false;
        } else {
          memoryPct.textContent = 'N/A';
          memoryProgress.removeAttribute('value');
          memorySub.textContent = 'Memory stats unavailable';
          memoryDetailsBtn.disabled = state.memoryDetails.length === 0 && state.topProcesses.length === 0;
        }

        const runningCount = state.apps.filter((a) => a.running).length;
        const bloatCount = state.apps.filter((a) => a.suggestedBloat && a.state === 'enabled').length;
        appsCount.textContent = state.apps.length + ' apps (' + runningCount + ' running, ' + bloatCount + ' bloat)';

        state.tempFiles = data.tempFiles || [];
        const tempBytes = state.tempFiles.reduce((acc, f) => acc + f.sizeBytes, 0);
        cleanTempBtn.textContent = 'Clean Temp Files (' + state.tempFiles.length + ')';
        cleanTempBtn.disabled = state.busy || state.tempFiles.length === 0;
        tempList.replaceChildren();
        if (state.tempFiles.length > 0) {
          const summary = document.createElement('span');
          summary.textContent = 'Found ' + fmtBytes(tempBytes) + ':';
          tempList.appendChild(summary);
          for (const f of state.tempFiles.slice(0, 4)) {
            const fileName = f.path.split('/').pop() || f.path;
            const chip = document.createElement('span');
            chip.className = 'temp-chip';
            const labelSpan = document.createElement('span');
            labelSpan.textContent = fileName + ' (' + fmtBytes(f.sizeBytes) + ')';
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'chip-delete-btn';
            delBtn.disabled = state.busy;
            delBtn.setAttribute('aria-label', 'Delete ' + fileName);
            delBtn.title = 'Delete ' + f.path;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 16 16');
            svg.setAttribute('width', '12');
            svg.setAttribute('height', '12');
            svg.setAttribute('aria-hidden', 'true');
            const crossPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            crossPath.setAttribute('d', 'M4 4l8 8M12 4l-8 8');
            crossPath.setAttribute('fill', 'none');
            crossPath.setAttribute('stroke', 'currentColor');
            crossPath.setAttribute('stroke-width', '2');
            crossPath.setAttribute('stroke-linecap', 'round');
            svg.appendChild(crossPath);
            delBtn.appendChild(svg);

            delBtn.addEventListener('click', async () => {
              if (state.busy) return;
              const ok = await askConfirmation(
                'Delete temporary file',
                'Delete ' + fileName + ' (' + fmtBytes(f.sizeBytes) + ') at ' + f.path + '?',
              );
              if (ok) void runCleanup({ type: 'clean-temp', paths: [f.path] });
            });

            chip.append(labelSpan, delBtn);
            tempList.appendChild(chip);
          }
          if (state.tempFiles.length > 4) {
            const more = document.createElement('span');
            more.textContent = '+' + (state.tempFiles.length - 4) + ' more';
            tempList.appendChild(more);
          }
        }
      }

      function applyFilter() {
        const filter = filterSelect.value;
        const query = searchInput.value.trim().toLowerCase();
        state.filtered = state.apps.filter((app) => {
          if (filter === 'bloat' && !app.suggestedBloat) return false;
          if (filter === 'running' && !app.running) return false;
          if (filter === 'launcher' && !app.inLauncher) return false;
          if (filter === 'user' && app.kind !== 'user') return false;
          if (filter === 'system' && app.kind !== 'system') return false;
          if (filter === 'inactive' && app.state === 'enabled') return false;
          if (query) {
            const matchPkg = app.name.toLowerCase().includes(query);
            const matchLabel = app.label ? app.label.toLowerCase().includes(query) : false;
            if (!matchPkg && !matchLabel) return false;
          }
          return true;
        });
        renderTable();
        updateControls();
      }

      function updateControls() {
        const count = state.selected.size;
        selectionSummary.textContent = count + ' selected • ' + state.filtered.length + ' shown';
        stopSelectedBtn.textContent = 'Force Stop (' + count + ')';
        hideSelectedBtn.textContent = 'Hide selected (' + count + ')';
        unhideSelectedBtn.textContent = 'Unhide selected (' + count + ')';
        uninstallSelectedBtn.textContent = 'Uninstall selected (' + count + ')';

        stopSelectedBtn.disabled = state.busy || count === 0;
        hideSelectedBtn.disabled = state.busy || count === 0;
        unhideSelectedBtn.disabled = state.busy || count === 0;
        uninstallSelectedBtn.disabled = state.busy || count === 0;
        clearSelectedBtn.disabled = state.busy || count === 0;
        trimCachesBtn.disabled = state.busy || !state.serial;
        stopUserBtn.disabled = state.busy || !state.serial;
        cleanTempBtn.disabled = state.busy || state.tempFiles.length === 0;
        refreshBtn.disabled = state.busy;
        for (const btn of tempList.querySelectorAll('.chip-delete-btn')) {
          btn.disabled = state.busy;
        }

        const allVis = state.filtered.length > 0 && state.filtered.every((a) => state.selected.has(a.name));
        const someVis = state.filtered.some((a) => state.selected.has(a.name));
        selectAllCb.checked = allVis;
        selectAllCb.indeterminate = !allVis && someVis;
      }

      function createFallbackIcon(app) {
        const span = document.createElement('span');
        span.className = 'app-icon-fallback';
        span.setAttribute('aria-hidden', 'true');
        const src = (app.label || app.name.split('.').pop() || app.name).trim();
        span.textContent = src.slice(0, 1).toUpperCase() || '?';
        return span;
      }

      function createIconNode(app) {
        if (app.hasIcon && state.serial) {
          const img = document.createElement('img');
          img.className = 'app-icon';
          img.width = 32;
          img.height = 32;
          img.loading = 'lazy';
          img.alt = '';
          const apkParam = app.apkPath ? '&apkPath=' + encodeURIComponent(app.apkPath) : '';
          img.src = '/api/app-icon?serial=' + encodeURIComponent(state.serial) + '&pkg=' + encodeURIComponent(app.name) + apkParam;
          img.addEventListener('error', () => {
            app.hasIcon = false;
            img.replaceWith(createFallbackIcon(app));
          }, { once: true });
          return img;
        }
        return createFallbackIcon(app);
      }

      function syncVersionCell(versionEl, versionCodeEl, app) {
        if (app.versionName) {
          versionEl.textContent = app.versionName;
          versionEl.dataset.empty = 'false';
          versionCodeEl.textContent = app.versionCode !== undefined ? ' (' + app.versionCode + ')' : '';
        } else if (app.versionCode !== undefined) {
          versionEl.textContent = '#' + app.versionCode;
          versionEl.dataset.empty = 'false';
          versionCodeEl.textContent = '';
        } else {
          versionEl.textContent = state.metaLoaded.has(app.name) ? '—' : '…';
          versionEl.dataset.empty = 'true';
          versionCodeEl.textContent = '';
        }
      }

      function updateRowMeta(app) {
        const ref = state.rowRefs.get(app.name);
        if (!ref) return;
        ref.labelEl.textContent = app.label || app.name;
        syncVersionCell(ref.versionEl, ref.versionCodeEl, app);
        if (app.hasIcon && ref.iconSlot.tagName !== 'IMG') {
          const next = createIconNode(app);
          ref.iconSlot.replaceWith(next);
          ref.iconSlot = next;
        } else if (!app.hasIcon && ref.iconSlot.tagName !== 'IMG') {
          const src = (app.label || app.name.split('.').pop() || app.name).trim();
          ref.iconSlot.textContent = src.slice(0, 1).toUpperCase() || '?';
        }
      }

      function makeBadge(text, kindAttr, stateAttr) {
        const span = document.createElement('span');
        span.className = 'badge';
        if (kindAttr) span.dataset.kind = kindAttr;
        if (stateAttr) span.dataset.state = stateAttr;
        span.textContent = text;
        return span;
      }

      function renderTable() {
        tbody.replaceChildren();
        state.rowRefs.clear();
        if (state.filtered.length === 0) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 6;
          td.className = 'empty-cell';
          td.textContent = 'No TV applications match the current filter.';
          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }

        const frag = document.createDocumentFragment();
        for (const app of state.filtered) {
          const tr = document.createElement('tr');

          const tdCheck = document.createElement('td');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = state.selected.has(app.name);
          cb.setAttribute('aria-label', 'Select ' + (app.label || app.name));
          cb.addEventListener('change', () => {
            if (cb.checked) state.selected.add(app.name);
            else state.selected.delete(app.name);
            updateControls();
          });
          tdCheck.appendChild(cb);

          const thApp = document.createElement('th');
          thApp.scope = 'row';
          const cell = document.createElement('div');
          cell.className = 'app-cell';
          const iconSlot = createIconNode(app);
          const names = document.createElement('div');
          names.className = 'app-names';
          const labelEl = document.createElement('span');
          labelEl.className = 'app-label';
          labelEl.textContent = app.label || app.name;
          const pkgEl = document.createElement('span');
          pkgEl.className = 'app-pkg';
          pkgEl.textContent = app.name;
          names.append(labelEl, pkgEl);
          cell.append(iconSlot, names);
          thApp.appendChild(cell);
          const tdVersion = document.createElement('td');
          tdVersion.className = 'version-cell';
          const versionEl = document.createElement('span');
          versionEl.className = 'app-version';
          const versionCodeEl = document.createElement('span');
          versionCodeEl.className = 'app-version-code';
          tdVersion.append(versionEl, versionCodeEl);
          syncVersionCell(versionEl, versionCodeEl, app);
          state.rowRefs.set(app.name, { iconSlot, labelEl, versionEl, versionCodeEl });

          const tdFlags = document.createElement('td');
          const badges = document.createElement('div');
          badges.className = 'badges';
          badges.appendChild(makeBadge(app.kind === 'user' ? '3rd-party' : 'system', app.kind));
          if (app.inLauncher) badges.appendChild(makeBadge('launcher', 'launcher'));
          if (app.running) badges.appendChild(makeBadge('running', 'running'));
          if (app.suggestedBloat) badges.appendChild(makeBadge('bloatware', 'bloat'));
          tdFlags.appendChild(badges);

          const tdStatus = document.createElement('td');
          tdStatus.appendChild(makeBadge(app.state, undefined, app.state));

          const tdActions = document.createElement('td');
          const actionsWrap = document.createElement('div');
          actionsWrap.className = 'row-actions';
          if (app.running) {
            const stopBtn = document.createElement('button');
            stopBtn.type = 'button';
            stopBtn.textContent = 'Stop';
            stopBtn.disabled = state.busy;
            stopBtn.addEventListener('click', () => runCleanup({ type: 'force-stop', packages: [app.name] }));
            actionsWrap.appendChild(stopBtn);
          }
          const clearBtn = document.createElement('button');
          clearBtn.type = 'button';
          clearBtn.textContent = 'Clear Data';
          clearBtn.disabled = state.busy;
          clearBtn.addEventListener('click', async () => {
            const ok = await askConfirmation('Clear app data', 'Delete all data & cache for ' + (app.label || app.name) + ' (' + app.name + ')? This logs you out of the app.');
            if (ok) runCleanup({ type: 'clear-data', packages: [app.name] });
          });
          actionsWrap.appendChild(clearBtn);

          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.disabled = state.busy;
          if (app.state === 'enabled') {
            toggleBtn.className = 'danger';
            toggleBtn.textContent = 'Hide';
            toggleBtn.addEventListener('click', () => runPackageAction('hide', [app]));
          } else {
            toggleBtn.className = 'primary';
            toggleBtn.textContent = 'Unhide';
            toggleBtn.addEventListener('click', () => runPackageAction('unhide', [app]));
          }
          actionsWrap.appendChild(toggleBtn);

          const uninstallBtn = document.createElement('button');
          uninstallBtn.type = 'button';
          uninstallBtn.className = 'danger';
          uninstallBtn.textContent = 'Uninstall';
          uninstallBtn.disabled = state.busy;
          uninstallBtn.addEventListener('click', () => runPackageAction('uninstall', [app]));
          actionsWrap.appendChild(uninstallBtn);

          tdActions.appendChild(actionsWrap);
          tr.append(tdCheck, thApp, tdVersion, tdFlags, tdStatus, tdActions);
          frag.appendChild(tr);
        }
        tbody.appendChild(frag);
      }

      async function loadMetaInBackground(serial, runId) {
        const ordered = [
          ...state.filtered.filter((a) => !state.metaLoaded.has(a.name)),
          ...state.apps.filter((a) => a.suggestedBloat && !state.metaLoaded.has(a.name)),
          ...state.apps.filter((a) => a.inLauncher && !state.metaLoaded.has(a.name)),
          ...state.apps.filter((a) => !state.metaLoaded.has(a.name)),
        ];
        const seen = new Set();
        const queue = [];
        for (const app of ordered) {
          if (!seen.has(app.name)) {
            seen.add(app.name);
            queue.push(app);
          }
        }
        const byName = new Map(state.apps.map((a) => [a.name, a]));
        for (let i = 0; i < queue.length; i += 12) {
          if (state.metaRunId !== runId || state.serial !== serial) return;
          const batch = queue.slice(i, i + 12);
          try {
            const res = await fetch('/api/packages/meta', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                serial,
                packages: batch.map((a) => ({ name: a.name, apkPath: a.apkPath })),
              }),
            });
            if (!res.ok) break;
            const data = await res.json();
            if (state.metaRunId !== runId || state.serial !== serial) return;
            for (const item of data.items) {
              state.metaLoaded.add(item.name);
              const entry = byName.get(item.name);
              if (entry) {
                if (item.label) entry.label = item.label;
                if (item.versionName) entry.versionName = item.versionName;
                if (item.versionCode !== undefined) entry.versionCode = item.versionCode;
                entry.hasIcon = Boolean(item.hasIcon);
                updateRowMeta(entry);
              }
            }
          } catch {
            break;
          }
        }
      }

      async function loadStatus() {
        state.busy = true;
        storageProgress.removeAttribute('value');
        memoryProgress.removeAttribute('value');
        updateControls();
        try {
          const res = await fetch('/api/tv/status?serial=' + encodeURIComponent(state.serial));
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to query TV status');

          state.apps = data.apps;
          state.optimizeSettings = data.optimizeSettings || null;
          state.metaLoaded = new Set(
            state.apps
              .filter((a) => a.label || a.hasIcon || a.versionName || a.versionCode !== undefined)
              .map((a) => a.name),
          );
          const existing = new Set(state.apps.map((a) => a.name));
          for (const s of [...state.selected]) {
            if (!existing.has(s)) state.selected.delete(s);
          }
          const s = data.summary;
          tvMeta.textContent = (s.model || s.serial) + ' (' + s.serial + ') • Android TV ' + (s.androidVersion || '?');
          renderTvArch(s);
          updateMetrics(data);
          applyFilter();
          if (optimizeDialog.open) renderOptimizeDialog();
          setStatus('Connected to ' + s.serial + ' (' + state.apps.length + ' packages loaded).', 'info');
          const runId = ++state.metaRunId;
          void loadMetaInBackground(state.serial, runId);
        } catch (err) {
          tvMeta.textContent = 'Disconnected (' + state.serial + ')';
          renderTvArch(null);
          setStatus((err instanceof Error ? err.message : String(err)) + ' — Check TV IP & accept USB debugging on the TV screen.', 'error');
        } finally {
          state.busy = false;
          renderTable();
          updateControls();
        }
      }

      async function runCleanup(payload) {
        if (state.busy) return;
        state.busy = true;
        updateControls();
        setStatus('Running TV cleanup (' + payload.type + ')…', 'info');
        try {
          const res = await fetch('/api/tv/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serial: state.serial, ...payload }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Cleanup failed');
          setStatus(data.message || 'Cleanup complete.', 'success');
          state.busy = false;
          await loadStatus();
        } catch (err) {
          setStatus(err instanceof Error ? err.message : String(err), 'error');
          state.busy = false;
          renderTable();
          updateControls();
        }
      }

      async function runPackageAction(action, targets) {
        if (state.busy || targets.length === 0) return;
        const method = methodSelect.value;
        const hasCritical = (action === 'hide' || action === 'uninstall') && targets.some((t) => criticalSet.has(t.name));
        if (action === 'uninstall' || targets.length > 1 || hasCritical) {
          const title = hasCritical
            ? 'Critical system package warning'
            : action === 'uninstall'
              ? 'Confirm uninstall'
              : 'Confirm batch action';
          const body = hasCritical
            ? 'Warning: ' + targets.map((t) => t.name).join(', ') + ' is a critical Android package. Continue ' + action + '?'
            : action === 'uninstall'
              ? 'Try to uninstall ' + (targets.length === 1 ? (targets[0].label || targets[0].name) + ' (' + targets[0].name + ')' : targets.length + ' selected package(s)') + '? This removes the app and its data (or uninstalls it for user 0 if it is a system app).'
              : (action === 'hide' ? 'Hide ' : 'Unhide ') + targets.length + ' selected package(s) using "' + method + '"?';
          if (!(await askConfirmation(title, body))) {
            setStatus('Cancelled.', 'info');
            return;
          }
        }

        state.busy = true;
        updateControls();
        setStatus((action === 'hide' ? 'Hiding ' : action === 'uninstall' ? 'Uninstalling ' : 'Unhiding ') + targets.length + ' app(s)…', 'info');
        try {
          const res = await fetch('/api/packages/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serial: state.serial,
              action,
              method,
              packages: targets.map((t) => ({ name: t.name, state: t.state })),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Package action failed');

          const byName = new Map(state.apps.map((a) => [a.name, a]));
          let okCount = 0;
          let failMsg = '';
          let lastMsg = '';
          const removedSet = new Set();
          for (const item of data.results) {
            if (item.ok) {
              okCount++;
              lastMsg = item.message || '';
              if (item.removed) {
                removedSet.add(item.name);
              } else {
                const entry = byName.get(item.name);
                if (entry && item.state) entry.state = item.state;
              }
              state.selected.delete(item.name);
            } else if (!failMsg) {
              failMsg = item.name + ': ' + (item.error || 'failed');
            }
          }
          if (removedSet.size > 0) {
            state.apps = state.apps.filter((a) => !removedSet.has(a.name));
          }
          if (!failMsg) {
            setStatus(okCount === 1 && lastMsg ? lastMsg : action + ' succeeded for ' + okCount + ' package(s).', 'success');
          } else if (okCount > 0) {
            setStatus(okCount + ' succeeded, failed: ' + failMsg, 'warn');
          } else {
            setStatus(failMsg, 'error');
          }
          applyFilter();
        } catch (err) {
          setStatus(err instanceof Error ? err.message : String(err), 'error');
        } finally {
          state.busy = false;
          renderTable();
          updateControls();
        }
      }

      connectForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const address = tvIpInput.value.trim();
        if (!address || state.busy) return;
        state.busy = true;
        updateControls();
        setStatus('Connecting TCP ADB to ' + address + '…', 'info');
        try {
          const res = await fetch('/api/tv/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to connect');
          state.serial = data.serial;
          tvIpInput.value = data.serial;
          state.selected.clear();
          state.busy = false;
          await loadStatus();
        } catch (err) {
          setStatus(err instanceof Error ? err.message : String(err), 'error');
          state.busy = false;
          updateControls();
        }
      });

      function openMemoryDetailsDialog() {
        memoryDetailsList.replaceChildren();
        memoryProcsTbody.replaceChildren();

        if (state.memory) {
          memoryDialogSummary.textContent = fmtBytes(state.memory.usedBytes) + ' used (' + state.memory.usedPercent + '%) • '
            + fmtBytes(state.memory.availableBytes) + ' available of ' + fmtBytes(state.memory.totalBytes);
        } else {
          memoryDialogSummary.textContent = 'RAM statistics from /proc/meminfo and running processes.';
        }

        const cards = [];
        if (state.memory) {
          cards.push({ label: 'Used RAM (est.)', bytes: state.memory.usedBytes });
        }
        for (const item of state.memoryDetails) {
          cards.push({ label: item.label, bytes: item.bytes });
        }
        if (cards.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'mem-stat';
          const dt = document.createElement('dt');
          dt.textContent = 'Status';
          const dd = document.createElement('dd');
          dd.textContent = 'Unavailable';
          empty.append(dt, dd);
          memoryDetailsList.appendChild(empty);
        } else {
          for (const item of cards) {
            const box = document.createElement('div');
            box.className = 'mem-stat';
            const dt = document.createElement('dt');
            dt.textContent = item.label;
            const dd = document.createElement('dd');
            dd.textContent = fmtBytes(item.bytes);
            box.append(dt, dd);
            memoryDetailsList.appendChild(box);
          }
        }

        if (state.topProcesses.length === 0) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 3;
          td.className = 'empty-cell';
          td.textContent = 'No per-process RSS memory stats reported.';
          tr.appendChild(td);
          memoryProcsTbody.appendChild(tr);
        } else {
          for (const proc of state.topProcesses) {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.scope = 'row';
            th.textContent = proc.name;
            const tdPid = document.createElement('td');
            tdPid.textContent = proc.pid;
            const tdRss = document.createElement('td');
            tdRss.className = 'mem-num';
            tdRss.textContent = fmtBytes(proc.rssBytes);
            tr.append(th, tdPid, tdRss);
            memoryProcsTbody.appendChild(tr);
          }
        }

        memoryDialog.showModal();
      }

      filterForm.addEventListener('submit', (e) => e.preventDefault());
      searchInput.addEventListener('input', applyFilter);
      filterSelect.addEventListener('change', applyFilter);
      refreshBtn.addEventListener('click', () => loadStatus());
      memoryDetailsBtn.addEventListener('click', openMemoryDetailsDialog);

      async function sendRemoteCommand(payload, label) {
        if (!state.serial) {
          remoteFeedback.textContent = 'No TV connected.';
          return;
        }
        remoteFeedback.textContent = 'Sending ' + label + '…';
        try {
          const res = await fetch('/api/tv/remote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serial: state.serial, ...payload }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Remote command failed');
          remoteFeedback.textContent = data.message || ('Sent ' + label);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          remoteFeedback.textContent = msg;
          setStatus(msg, 'error');
        }
      }

      remoteBtn.addEventListener('click', () => {
        remoteTargetLabel.textContent = state.serial ? 'Target: ' + state.serial : 'No TV connected';
        remoteDialog.showModal();
      });

      remoteDialog.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-remote-key]') : null;
        if (!(btn instanceof HTMLButtonElement)) return;
        const key = btn.dataset.remoteKey;
        if (key) void sendRemoteCommand({ key }, key.toUpperCase());
      });

      remoteDialog.addEventListener('keydown', (e) => {
        if (e.target === remoteTextInput || e.ctrlKey || e.metaKey || e.altKey) return;
        const keyMap = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
          Backspace: 'back',
        };
        const mapped = keyMap[e.key];
        if (mapped) {
          e.preventDefault();
          void sendRemoteCommand({ key: mapped }, mapped.toUpperCase());
        }
      });

      remoteTextForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = remoteTextInput.value;
        if (!text) return;
        await sendRemoteCommand({ text }, 'text');
        remoteTextInput.value = '';
      });

      function setOptimizeFeedback(msg, kind = 'info') {
        optimizeFeedback.textContent = msg;
        optimizeFeedback.dataset.kind = kind;
      }

      function setOptimizeInspector(title, body) {
        optimizeInspectorTitle.textContent = title;
        optimizeInspectorBody.textContent = body;
      }

      function getFixLiveStatus(fix) {
        const byName = new Map(state.apps.map((a) => [a.name, a]));
        if (Array.isArray(fix.packages) && fix.packages.length > 0) {
          const present = fix.packages.map((pkg) => byName.get(pkg)).filter(Boolean);
          if (present.length === 0) {
            return {
              kind: 'na',
              text: 'Not installed',
              canApply: false,
              canRevert: false,
              present,
            };
          }
          const enabled = present.filter((a) => a.state === 'enabled');
          const disabled = present.filter((a) => a.state !== 'enabled');
          if (enabled.length === 0) {
            return {
              kind: 'applied',
              text: 'Applied (' + disabled.length + '/' + present.length + ' disabled)',
              canApply: false,
              canRevert: fix.reversible,
              present,
            };
          }
          if (disabled.length > 0) {
            return {
              kind: 'partial',
              text: enabled.length + ' active • ' + disabled.length + ' disabled',
              canApply: true,
              canRevert: fix.reversible,
              present,
            };
          }
          return {
            kind: 'available',
            text: enabled.length + ' matching app(s) active',
            canApply: true,
            canRevert: false,
            present,
          };
        }

        const cfg = state.optimizeSettings;
        if (fix.id === 'enable-adguard-dns') {
          const applied = Boolean(cfg && cfg.privateDnsMode === 'hostname' && cfg.privateDnsSpecifier === 'dns.adguard-dns.com');
          const currentLabel = cfg && cfg.privateDnsMode === 'hostname' && cfg.privateDnsSpecifier
            ? 'DNS: ' + cfg.privateDnsSpecifier
            : 'DNS: ' + ((cfg && cfg.privateDnsMode) || 'default');
          return {
            kind: applied ? 'applied' : 'available',
            text: applied ? 'Applied (AdGuard DNS)' : currentLabel,
            canApply: !applied,
            canRevert: applied || Boolean(cfg && cfg.privateDnsMode === 'hostname'),
            present: [],
          };
        }

        if (fix.id === 'disable-tracking-settings') {
          const locOff = cfg && cfg.locationMode === '0';
          const logOff = cfg && cfg.activityStartsLogging === '0';
          const applied = Boolean(locOff && logOff);
          return {
            kind: applied ? 'applied' : 'available',
            text: applied
              ? 'Applied (tracking off)'
              : 'Location: ' + ((cfg && cfg.locationMode) || '?') + ' • Logging: ' + ((cfg && cfg.activityStartsLogging) || '?'),
            canApply: !applied,
            canRevert: Boolean(locOff || logOff),
            present: [],
          };
        }

        if (fix.id === 'speedup-animations') {
          const isFast = Boolean(
            cfg
            && cfg.windowAnimationScale === '0.5'
            && cfg.transitionAnimationScale === '0.5'
            && cfg.animatorDurationScale === '0.5',
          );
          const curScale = (cfg && cfg.windowAnimationScale) || '1.0';
          return {
            kind: isFast ? 'applied' : 'available',
            text: isFast ? 'Applied (0.5x)' : 'Current: ' + curScale + 'x',
            canApply: !isFast,
            canRevert: isFast || curScale === '0' || curScale === '0.0',
            present: [],
          };
        }

        if (fix.id === 'trim-caches-and-stop-bloat') {
          const runningBloat = state.apps.filter((a) => a.running && (a.suggestedBloat || a.kind === 'user')).length;
          return {
            kind: 'available',
            text: runningBloat > 0 ? runningBloat + ' running target(s)' : 'Ready',
            canApply: true,
            canRevert: false,
            present: [],
          };
        }

        return {
          kind: 'available',
          text: 'Manual action',
          canApply: true,
          canRevert: false,
          present: [],
        };
      }

      function renderOptimizeDialog() {
        optimizeDialogSummary.textContent = state.serial
          ? 'Target TV: ' + state.serial + '. Each button below lists what it changes and can be inspected before running.'
          : 'Connect a TV first to apply optimizations.';

        for (const btn of optimizeFilters.querySelectorAll('[data-opt-cat]')) {
          const active = btn.dataset.optCat === state.optimizeCategory;
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        }

        const visibleFixes = optimizeFixes.filter((fix) =>
          state.optimizeCategory === 'all' || fix.category === state.optimizeCategory,
        );

        const openDetailsIds = new Set(
          Array.from(optimizeList.querySelectorAll('details.opt-details[open]'))
            .map((el) => el.dataset.optDetails)
            .filter(Boolean),
        );

        optimizeList.replaceChildren();
        const frag = document.createDocumentFragment();
        for (const fix of visibleFixes) {
          const live = getFixLiveStatus(fix);
          const li = document.createElement('li');
          li.className = 'opt-item';

          const head = document.createElement('div');
          head.className = 'opt-item-head';

          const titleWrap = document.createElement('div');
          titleWrap.className = 'opt-item-title-wrap';
          const titleEl = document.createElement('span');
          titleEl.className = 'opt-item-title';
          titleEl.textContent = fix.label;

          const badges = document.createElement('div');
          badges.className = 'badges';
          const catBadge = makeBadge(fix.category, 'system');
          const riskBadge = document.createElement('span');
          riskBadge.className = 'badge';
          riskBadge.dataset.optRisk = fix.risk;
          riskBadge.textContent = fix.risk === 'caution' ? 'Caution' : 'Safe';
          const statusBadge = document.createElement('span');
          statusBadge.className = 'badge';
          statusBadge.dataset.optStatus = live.kind;
          statusBadge.textContent = live.text;
          badges.append(catBadge, riskBadge, statusBadge);
          titleWrap.append(titleEl, badges);

          const actions = document.createElement('div');
          actions.className = 'opt-item-actions';

          const descId = 'opt-desc-' + fix.id;
          const applyBtn = document.createElement('button');
          applyBtn.type = 'button';
          applyBtn.className = (fix.risk === 'caution' ? 'danger' : 'primary') + ' compact-btn';
          applyBtn.dataset.optFix = fix.id;
          applyBtn.dataset.optMode = 'apply';
          applyBtn.setAttribute('aria-describedby', descId);
          applyBtn.disabled = state.busy || !state.serial || !live.canApply;
          applyBtn.append(document.createTextNode(live.kind === 'applied' ? 'Applied' : 'Apply'));
          const applySr = document.createElement('span');
          applySr.className = 'visually-hidden';
          applySr.textContent = ' — ' + fix.label;
          applyBtn.appendChild(applySr);
          const previewApply = () => setOptimizeInspector('Apply: ' + fix.label, fix.description);
          applyBtn.addEventListener('pointerenter', previewApply);
          applyBtn.addEventListener('focus', previewApply);
          applyBtn.addEventListener('click', () => { void runOptimizeFix(fix, 'apply'); });
          actions.appendChild(applyBtn);

          if (fix.reversible) {
            const undoBtn = document.createElement('button');
            undoBtn.type = 'button';
            undoBtn.className = 'compact-btn';
            undoBtn.dataset.optFix = fix.id;
            undoBtn.dataset.optMode = 'revert';
            undoBtn.setAttribute('aria-describedby', descId);
            undoBtn.disabled = state.busy || !state.serial || !live.canRevert;
            undoBtn.append(document.createTextNode('Undo'));
            const undoSr = document.createElement('span');
            undoSr.className = 'visually-hidden';
            undoSr.textContent = ' — ' + fix.label;
            undoBtn.appendChild(undoSr);
            const previewUndo = () => setOptimizeInspector(
              'Undo: ' + fix.label,
              fix.revertDescription || ('Reverts "' + fix.label + '" to its previous state.'),
            );
            undoBtn.addEventListener('pointerenter', previewUndo);
            undoBtn.addEventListener('focus', previewUndo);
            undoBtn.addEventListener('click', () => { void runOptimizeFix(fix, 'revert'); });
            actions.appendChild(undoBtn);
          }

          head.append(titleWrap, actions);

          const descEl = document.createElement('p');
          descEl.className = 'opt-item-desc';
          descEl.id = descId;
          descEl.textContent = fix.description;

          const details = document.createElement('details');
          details.className = 'opt-details';
          details.dataset.optDetails = fix.id;
          if (openDetailsIds.has(fix.id)) details.open = true;
          const summary = document.createElement('summary');
          summary.textContent = 'Action details & ADB commands';
          details.appendChild(summary);

          const detailsBody = document.createElement('div');
          detailsBody.className = 'opt-details-body';

          if (Array.isArray(fix.commands) && fix.commands.length > 0) {
            const cmdHeading = document.createElement('span');
            cmdHeading.className = 'metric-sub';
            cmdHeading.textContent = 'Apply commands:';
            const cmdList = document.createElement('ul');
            cmdList.className = 'opt-cmd-list';
            for (const cmd of fix.commands) {
              const cli = document.createElement('li');
              const code = document.createElement('code');
              code.textContent = cmd;
              cli.appendChild(code);
              cmdList.appendChild(cli);
            }
            detailsBody.append(cmdHeading, cmdList);
          }

          if (fix.reversible && fix.revertDescription) {
            const revText = document.createElement('span');
            revText.className = 'metric-sub';
            revText.textContent = 'Undo action: ' + fix.revertDescription;
            detailsBody.appendChild(revText);
          }

          if (live.present.length > 0) {
            const pkgHeading = document.createElement('span');
            pkgHeading.className = 'metric-sub';
            pkgHeading.textContent = 'Matching packages on this TV (' + live.present.length + '):';
            const chips = document.createElement('div');
            chips.className = 'opt-pkg-chips';
            for (const pkg of live.present) {
              const chip = document.createElement('span');
              chip.className = 'opt-pkg-chip';
              chip.dataset.state = pkg.state;
              chip.textContent = pkg.name + ' [' + pkg.state + (pkg.running ? ', running' : '') + ']';
              chips.appendChild(chip);
            }
            detailsBody.append(pkgHeading, chips);
          }

          details.appendChild(detailsBody);
          li.append(head, descEl, details);
          frag.appendChild(li);
        }
        optimizeList.appendChild(frag);
      }

      async function runOptimizeFix(fix, mode) {
        if (state.busy || !state.serial) return;
        if (mode === 'apply' && fix.requiresConfirm) {
          const ok = await askConfirmation(
            fix.label,
            fix.description + ' Proceed now?',
          );
          if (!ok) {
            setOptimizeFeedback('Cancelled "' + fix.label + '".', 'info');
            return;
          }
        }

        state.busy = true;
        updateControls();
        renderOptimizeDialog();
        const verb = mode === 'apply' ? 'Applying' : 'Undoing';
        setOptimizeFeedback(verb + ' "' + fix.label + '"…', 'info');
        setStatus(verb + ' optimization: ' + fix.label + '…', 'info');
        try {
          const res = await fetch('/api/tv/optimize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serial: state.serial,
              fixId: fix.id,
              mode,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Optimization failed');
          const msg = data.message || (fix.label + ' completed.');
          const kind = data.ok ? 'success' : 'warn';
          setOptimizeFeedback(msg, kind);
          setStatus(msg, kind);
          state.busy = false;
          if (data.disconnected) {
            updateControls();
            renderOptimizeDialog();
          } else {
            await loadStatus();
            if (optimizeDialog.open) renderOptimizeDialog();
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setOptimizeFeedback(msg, 'error');
          setStatus(msg, 'error');
          state.busy = false;
          renderTable();
          updateControls();
          if (optimizeDialog.open) renderOptimizeDialog();
        }
      }

      if (!('commandForElement' in HTMLButtonElement.prototype)) {
        optimizeBtn.addEventListener('click', () => {
          renderOptimizeDialog();
          if (!optimizeDialog.open) optimizeDialog.showModal();
        });
        optimizeCloseBtn.addEventListener('click', () => {
          optimizeDialog.close();
        });
      } else {
        optimizeDialog.addEventListener('command', (event) => {
          if (event.command === 'show-modal') {
            renderOptimizeDialog();
          }
        });
      }

      optimizeFilters.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-opt-cat]') : null;
        if (!(btn instanceof HTMLButtonElement)) return;
        const cat = btn.dataset.optCat;
        if (!cat) return;
        state.optimizeCategory = cat;
        renderOptimizeDialog();
      });

      trimCachesBtn.addEventListener('click', () => runCleanup({ type: 'trim-caches' }));
      stopUserBtn.addEventListener('click', () => {
        const runningUser = state.apps.filter((a) => a.running && a.kind === 'user').map((a) => a.name);
        if (runningUser.length === 0) {
          setStatus('No 3rd-party apps are currently running.', 'info');
          return;
        }
        runCleanup({ type: 'force-stop', packages: runningUser });
      });
      cleanTempBtn.addEventListener('click', async () => {
        if (state.tempFiles.length === 0) return;
        const ok = await askConfirmation(
          'Delete temporary files',
          'Remove ' + state.tempFiles.length + ' temporary/APK file(s) from /data/local/tmp and /sdcard/Download?',
        );
        if (ok) runCleanup({ type: 'clean-temp', paths: state.tempFiles.map((f) => f.path) });
      });

      selectAllCb.addEventListener('change', () => {
        for (const app of state.filtered) {
          if (selectAllCb.checked) state.selected.add(app.name);
          else state.selected.delete(app.name);
        }
        renderTable();
        updateControls();
      });

      clearSelectedBtn.addEventListener('click', () => {
        state.selected.clear();
        renderTable();
        updateControls();
      });

      stopSelectedBtn.addEventListener('click', () => {
        const names = state.apps.filter((a) => state.selected.has(a.name)).map((a) => a.name);
        if (names.length > 0) runCleanup({ type: 'force-stop', packages: names });
      });

      hideSelectedBtn.addEventListener('click', () => {
        const targets = state.apps.filter((a) => state.selected.has(a.name) && a.state === 'enabled');
        if (targets.length === 0) {
          setStatus('Selected packages are already hidden/disabled.', 'warn');
          return;
        }
        runPackageAction('hide', targets);
      });

      unhideSelectedBtn.addEventListener('click', () => {
        const targets = state.apps.filter((a) => state.selected.has(a.name) && a.state !== 'enabled');
        if (targets.length === 0) {
          setStatus('Selected packages are already enabled.', 'warn');
          return;
        }
        runPackageAction('unhide', targets);
      });

      uninstallSelectedBtn.addEventListener('click', () => {
        const targets = state.apps.filter((a) => state.selected.has(a.name));
        if (targets.length === 0) return;
        runPackageAction('uninstall', targets);
      });

${renderApkDropzoneScript('await loadStatus();', 'renderTable(); updateControls();')}

      loadStatus();
    })();
  </script>
</body>
</html>`;
}

/**
 * Create the local HTTP server for the TCP TV Cleanup GUI and API.
 */
export function createTvCleanupServer(
  session: AdbSession,
  initialConfig: { tvSerial: string; tvHost: string; tvPort: number },
): http.Server {
  const metaCache = new Map<string, CachedTvMeta>();

  const getOrLoadMeta = async (
    device: DeviceClient,
    serial: string,
    pkg: string,
    apkPath?: string,
  ): Promise<CachedTvMeta> => {
    const key = `${serial}:${pkg}`;
    const cached = metaCache.get(key);
    if (cached) return cached;
    const parsed = await extractApkMetadata(device, pkg, apkPath);
    const entry: CachedTvMeta = {
      label: parsed.label,
      versionName: parsed.versionName,
      versionCode: parsed.versionCode,
      iconData: parsed.icon?.data,
      iconMime: parsed.icon?.mime,
    };
    metaCache.set(key, entry);
    return entry;
  };

  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (!isFetchSiteAllowed(req)) {
        sendJson(res, 403, { error: 'Cross-site requests are forbidden' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/') {
        const nonce = crypto.randomBytes(16).toString('base64');
        const csp = [
          "default-src 'self'",
          `script-src 'nonce-${nonce}'`,
          `style-src 'nonce-${nonce}'`,
          "object-src 'none'",
          "base-uri 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
        ].join('; ');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': csp,
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Resource-Policy': 'same-origin',
        });
        res.end(renderTvCleanupPage(nonce, initialConfig));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/tv/connect') {
        const body = await readJsonBody(req);
        const rawAddr = typeof body.address === 'string' ? body.address.trim() : '';
        if (!rawAddr) {
          sendJson(res, 400, { error: 'Missing TV IP address' });
          return;
        }
        const parsed = parseHostPort(rawAddr, 5555);
        const serial = `${parsed.host}:${parsed.port}`;
        const startedAt = logActionStart(serial, 'tv-connect');
        try {
          const connected = await session.runWithClient(client => client.connect(parsed.host, parsed.port));
          logActionResult(serial, 'tv-connect', startedAt, true, connected ? 'connected' : 'already connected');
          sendJson(res, 200, { connected, serial });
        } catch (err) {
          logActionResult(serial, 'tv-connect', startedAt, false, err instanceof Error ? err.message : String(err));
          throw err;
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/tv/status') {
        const serial = url.searchParams.get('serial')?.trim() || initialConfig.tvSerial;
        if (!serial) {
          sendJson(res, 400, { error: 'Missing serial' });
          return;
        }
        const data = await session.runWithClient(async (client) => {
          const device = client.getDevice(serial);
          const status = await fetchTvStatus(device);
          const apps = status.apps.map((app) => {
            const cached = metaCache.get(`${serial}:${app.name}`);
            if (!cached) return app;
            return {
              ...app,
              label: cached.label,
              versionName: cached.versionName,
              versionCode: cached.versionCode,
              hasIcon: Boolean(cached.iconData),
            };
          });
          return { ...status, apps };
        });
        sendJson(res, 200, data);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/packages/meta') {
        const body = await readJsonBody(req);
        const serial = typeof body.serial === 'string' ? body.serial.trim() : '';
        const rawPackages = body.packages;
        if (!serial || !Array.isArray(rawPackages) || rawPackages.length === 0 || rawPackages.length > 30) {
          sendJson(res, 400, { error: 'Invalid serial or packages batch' });
          return;
        }
        const targets: Array<{ name: string; apkPath?: string }> = [];
        for (const item of rawPackages) {
          if (!item || typeof item !== 'object') {
            sendJson(res, 400, { error: 'Invalid package item' });
            return;
          }
          const rec = item as Record<string, unknown>;
          const name = typeof rec.name === 'string' ? rec.name.trim() : '';
          const apkPath = typeof rec.apkPath === 'string' ? rec.apkPath.trim() : undefined;
          if (!RE_PACKAGE_NAME.test(name)) {
            sendJson(res, 400, { error: `Invalid package name: ${name}` });
            return;
          }
          targets.push({ name, apkPath });
        }
        const items = await session.runWithClient(async (client) => {
          const device = client.getDevice(serial);
          return mapWithConcurrency(targets, 4, async (target) => {
            const meta = await getOrLoadMeta(device, serial, target.name, target.apkPath);
            return {
              name: target.name,
              label: meta.label,
              versionName: meta.versionName,
              versionCode: meta.versionCode,
              hasIcon: Boolean(meta.iconData),
            };
          });
        });
        sendJson(res, 200, { items });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/app-icon') {
        const serial = url.searchParams.get('serial')?.trim();
        const pkg = url.searchParams.get('pkg')?.trim();
        const apkPath = url.searchParams.get('apkPath')?.trim() || undefined;
        if (!serial || !pkg || !RE_PACKAGE_NAME.test(pkg)) {
          sendJson(res, 400, { error: 'Invalid serial or pkg' });
          return;
        }
        const meta = await session.runWithClient(client =>
          getOrLoadMeta(client.getDevice(serial), serial, pkg, apkPath),
        );
        if (!meta.iconData || !meta.iconMime) {
          res.writeHead(204, {
            'Cache-Control': 'private, max-age=300',
            'Cross-Origin-Resource-Policy': 'same-origin',
          });
          res.end();
          return;
        }
        const headers: Record<string, string> = {
          'Content-Type': meta.iconMime,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Resource-Policy': 'same-origin',
        };
        if (meta.iconMime === 'image/svg+xml') {
          headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
        }
        res.writeHead(200, headers);
        res.end(meta.iconData);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/tv/remote') {
        const body = await readJsonBody(req);
        const serial = typeof body.serial === 'string' && body.serial.trim()
          ? body.serial.trim()
          : initialConfig.tvSerial;
        const key = typeof body.key === 'string' ? body.key.trim() : '';
        const rawText = typeof body.text === 'string' ? body.text : '';

        if (!serial) {
          sendJson(res, 400, { error: 'Missing serial' });
          return;
        }

        if (key) {
          if (!Object.hasOwn(TV_REMOTE_KEYS, key)) {
            sendJson(res, 400, { error: `Unknown remote key: ${key}` });
            return;
          }
          const keyCode = TV_REMOTE_KEYS[key as TvRemoteKeyName];
          const startedAt = logActionStart(serial, 'remote-key', `${key} (${keyCode})`);
          try {
            await session.runWithClient(client =>
              client.getDevice(serial).execOut(['input', 'keyevent', String(keyCode)], 'utf8'),
            );
            const message = `Sent ${key} (keycode ${keyCode}) to ${serial}.`;
            logActionResult(serial, 'remote-key', startedAt, true, message);
            sendJson(res, 200, { ok: true, key, keyCode, message });
          } catch (err) {
            logActionResult(serial, 'remote-key', startedAt, false, err instanceof Error ? err.message : String(err));
            throw err;
          }
          return;
        }

        if (rawText) {
          let encoded: string;
          try {
            encoded = formatRemoteInputText(rawText);
          } catch (err) {
            sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
            return;
          }
          const startedAt = logActionStart(serial, 'remote-text', `${rawText.length} char(s)`);
          try {
            await session.runWithClient(client =>
              client.getDevice(serial).execOut(['input', 'text', encoded], 'utf8'),
            );
            const message = `Sent ${rawText.length} character(s) to ${serial}.`;
            logActionResult(serial, 'remote-text', startedAt, true, message);
            sendJson(res, 200, { ok: true, message });
          } catch (err) {
            logActionResult(serial, 'remote-text', startedAt, false, err instanceof Error ? err.message : String(err));
            throw err;
          }
          return;
        }

        sendJson(res, 400, { error: 'Expected key or text' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/tv/cleanup') {
        const body = await readJsonBody(req);
        const serial = typeof body.serial === 'string' ? body.serial.trim() : '';
        const type = body.type;
        if (!serial) {
          sendJson(res, 400, { error: 'Missing serial' });
          return;
        }

        if (type === 'trim-caches') {
          const startedAt = logActionStart(serial, 'trim-caches');
          try {
            const message = await session.runWithClient(client => trimTvCaches(client.getDevice(serial)));
            logActionResult(serial, 'trim-caches', startedAt, true, message);
            sendJson(res, 200, { message });
          } catch (err) {
            logActionResult(serial, 'trim-caches', startedAt, false, err instanceof Error ? err.message : String(err));
            throw err;
          }
          return;
        }

        if (type === 'force-stop') {
          const rawPkgs = body.packages;
          if (!Array.isArray(rawPkgs) || rawPkgs.length === 0) {
            sendJson(res, 400, { error: 'Missing packages' });
            return;
          }
          const pkgs = rawPkgs.map(p => (typeof p === 'string' ? p.trim() : ''));
          if (pkgs.some(p => !RE_PACKAGE_NAME.test(p))) {
            sendJson(res, 400, { error: 'Invalid package name' });
            return;
          }
          const startedAt = logActionStart(serial, 'force-stop', `${pkgs.length} app(s)`);
          try {
            await session.runWithClient(async (client) => {
              const device = client.getDevice(serial);
              for (const pkg of pkgs) {
                await device.execOut(['am', 'force-stop', pkg], 'utf8');
                console.log(`  ✓ force-stopped ${pkg}`);
              }
            });
            const message = `Force-stopped ${pkgs.length} app(s).`;
            logActionResult(serial, 'force-stop', startedAt, true, message);
            sendJson(res, 200, { message });
          } catch (err) {
            logActionResult(serial, 'force-stop', startedAt, false, err instanceof Error ? err.message : String(err));
            throw err;
          }
          return;
        }

        if (type === 'clear-data') {
          const rawPkgs = body.packages;
          if (!Array.isArray(rawPkgs) || rawPkgs.length === 0) {
            sendJson(res, 400, { error: 'Missing packages' });
            return;
          }
          const pkgs = rawPkgs.map(p => (typeof p === 'string' ? p.trim() : ''));
          if (pkgs.some(p => !RE_PACKAGE_NAME.test(p))) {
            sendJson(res, 400, { error: 'Invalid package name' });
            return;
          }
          const startedAt = logActionStart(serial, 'clear-data', pkgs.join(', '));
          try {
            await session.runWithClient(async (client) => {
              const device = client.getDevice(serial);
              for (const pkg of pkgs) {
                await device.clear(pkg);
                console.log(`  ✓ cleared data for ${pkg}`);
              }
            });
            const message = `Cleared data for ${pkgs.join(', ')}.`;
            logActionResult(serial, 'clear-data', startedAt, true, message);
            sendJson(res, 200, { message });
          } catch (err) {
            logActionResult(serial, 'clear-data', startedAt, false, err instanceof Error ? err.message : String(err));
            throw err;
          }
          return;
        }

        if (type === 'clean-temp') {
          const rawPaths = body.paths;
          if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
            sendJson(res, 400, { error: 'Missing temp file paths' });
            return;
          }
          const paths = rawPaths.map(p => (typeof p === 'string' ? p.trim() : ''));
          if (paths.some(p => !isAllowedTempFilePath(p))) {
            sendJson(res, 400, { error: 'Disallowed temp file path' });
            return;
          }
          const startedAt = logActionStart(serial, 'clean-temp', `${paths.length} file(s)`);
          try {
            await session.runWithClient(client => client.getDevice(serial).execOut(['rm', '-f', ...paths], 'utf8'));
            for (const p of paths) {
              console.log(`  ✓ deleted ${p}`);
            }
            const message = `Deleted ${paths.length} temporary file(s).`;
            logActionResult(serial, 'clean-temp', startedAt, true, message);
            sendJson(res, 200, { message });
          } catch (err) {
            logActionResult(serial, 'clean-temp', startedAt, false, err instanceof Error ? err.message : String(err));
            throw err;
          }
          return;
        }

        sendJson(res, 400, { error: 'Unknown cleanup type' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/tv/optimize') {
        const body = await readJsonBody(req);
        const serial = typeof body.serial === 'string' && body.serial.trim()
          ? body.serial.trim()
          : initialConfig.tvSerial;
        const fixId = typeof body.fixId === 'string' ? body.fixId.trim() : '';
        const rawMode = body.mode === undefined ? 'apply' : body.mode;

        if (!serial) {
          sendJson(res, 400, { error: 'Missing serial' });
          return;
        }
        if (!isTvOptimizeFixId(fixId)) {
          sendJson(res, 400, { error: `Unknown optimization fix: ${fixId}` });
          return;
        }
        if (rawMode !== 'apply' && rawMode !== 'revert') {
          sendJson(res, 400, { error: 'Invalid mode (expected apply or revert)' });
          return;
        }
        const fix = OPTIMIZE_FIX_MAP.get(fixId);
        if (rawMode === 'revert' && fix && !fix.reversible) {
          sendJson(res, 400, { error: `Optimization "${fix.label}" cannot be reverted automatically.` });
          return;
        }

        const startedAt = logActionStart(serial, 'optimize', `${rawMode}:${fixId}`);
        try {
          const result = await session.runWithClient(client =>
            applyTvOptimizeFix(client.getDevice(serial), fixId, rawMode),
          );
          logActionResult(serial, 'optimize', startedAt, result.ok, result.message);
          sendJson(res, 200, result);
        } catch (err) {
          logActionResult(serial, 'optimize', startedAt, false, err instanceof Error ? err.message : String(err));
          throw err;
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/packages/install') {
        await handleApkSideloadRequest(req, res, url, session, initialConfig.tvSerial);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/packages/action') {
        const body = await readJsonBody(req);
        const serial = typeof body.serial === 'string' ? body.serial.trim() : '';
        const action = body.action;
        const method = body.method as HideMethod;
        const rawPackages = body.packages;

        if (!serial || (action !== 'hide' && action !== 'unhide' && action !== 'uninstall') || !METHODS.includes(method) || !Array.isArray(rawPackages) || rawPackages.length === 0) {
          sendJson(res, 400, { error: 'Invalid action request' });
          return;
        }

        const targets: Array<{ name: string; state: AppState }> = [];
        for (const item of rawPackages) {
          if (!item || typeof item !== 'object') {
            sendJson(res, 400, { error: 'Invalid package item' });
            return;
          }
          const rec = item as Record<string, unknown>;
          const name = typeof rec.name === 'string' ? rec.name.trim() : '';
          if (!RE_PACKAGE_NAME.test(name)) {
            sendJson(res, 400, { error: `Invalid package name: ${name}` });
            return;
          }
          const validState: AppState = rec.state === 'disabled' || rec.state === 'hidden' ? rec.state : 'enabled';
          targets.push({ name, state: validState });
        }

        const results = await session.runWithClient(async (client) => {
          const device = client.getDevice(serial);
          return executePackageBatch(device, serial, action, method, targets);
        });

        sendJson(res, 200, { results });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    })().catch((err: unknown) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } else {
        res.end();
      }
    });
  });
}

function openBrowserUrl(targetUrl: string): void {
  try {
    const cmd = process.platform === 'darwin'
      ? { bin: 'open', args: [targetUrl] }
      : process.platform === 'win32'
        ? { bin: 'cmd', args: ['/c', 'start', '', targetUrl] }
        : { bin: 'xdg-open', args: [targetUrl] };
    const child = spawn(cmd.bin, cmd.args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      // Ignore browser-launch failures in headless environments.
    });
    child.unref();
  } catch {
    // Ignore browser-launch failures.
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseTvCliArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const session = createAdbSession(options);
  try {
    const connected = await session.runWithClient(client => client.connect(options.tvHost, options.tvPort));
    console.log(connected
      ? `Connected to TV at ${options.tvSerial}`
      : `TV ${options.tvSerial} already connected (or awaiting authorization)`);
  } catch (err) {
    console.warn(`Initial TCP connect to ${options.tvSerial} failed (${err instanceof Error ? err.message : String(err)}). You can retry from the GUI.`);
  }

  const server = createTvCleanupServer(session, {
    tvSerial: options.tvSerial,
    tvHost: options.tvHost,
    tvPort: options.tvPort,
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.uiPort, options.uiHost);
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : options.uiPort;
  const guiUrl = `http://localhost:${port}`;
  console.log(`adbkit TV Cleanup GUI running at ${guiUrl}`);
  console.log('Press Ctrl+C to stop.');

  if (options.openBrowser) {
    openBrowserUrl(guiUrl);
  }

  await new Promise<void>((resolve) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      server.close(() => resolve());
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

  if (options.backend !== 'native') {
    await YaWebAdbManager.getInstance().killAll();
  }
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
  }
}

if (isEntrypoint()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
