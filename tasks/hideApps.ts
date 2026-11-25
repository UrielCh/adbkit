import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createClient,
  DeviceClient,
  YaWebAdbManager,
  type AdbOptions,
  type Device,
} from '../src/index.js';
import { extractApkMetadata } from './apkMeta.js';

export type AppState = 'enabled' | 'disabled' | 'hidden';
export type AppKind = 'user' | 'system';
export type AppFilter = 'all' | 'launcher' | 'user' | 'system' | 'inactive' | 'enabled';
export type HideMethod = 'auto' | 'hide' | 'disable' | 'uninstall';

export interface AppEntry {
  name: string;
  state: AppState;
  kind: AppKind;
  inLauncher?: boolean;
  apkPath?: string;
  label?: string;
  hasIcon?: boolean;
}

interface CachedAppMetadata {
  label?: string;
  iconData?: Buffer;
  iconMime?: string;
}

export interface HideAppsCliOptions {
  serial?: string;
  host?: string;
  port?: number;
  uiHost: string;
  uiPort: number;
  connect?: string;
  backend?: AdbOptions['backend'];
  filter: AppFilter;
  method: HideMethod;
  listOnly: boolean;
  help: boolean;
}

export interface PmActionResult {
  state: AppState;
  methodUsed: string;
  message: string;
  removed?: boolean;
}

export interface DeviceSummary {
  serial: string;
  model: string;
  androidVersion: string;
  sdk: string;
  abi: string;
  abiList: string[];
}

export interface ListedDeviceInfo {
  id: string;
  type: Device['type'];
  model: string;
  androidVersion: string;
  abi: string;
}

export interface BatchActionItemResult {
  name: string;
  ok: boolean;
  state?: AppState;
  removed?: boolean;
  methodUsed?: string;
  message?: string;
  error?: string;
}

const METHODS: readonly HideMethod[] = ['auto', 'hide', 'disable', 'uninstall'];
const RE_PACKAGE_NAME = /^[a-zA-Z0-9._-]+$/;

export const CRITICAL_PACKAGES = new Set<string>([
  'android',
  'com.android.systemui',
  'com.android.settings',
  'com.android.phone',
  'com.android.providers.settings',
  'com.android.shell',
  'com.android.packageinstaller',
  'com.google.android.packageinstaller',
]);

/**
 * Parse CLI arguments for the app hider web server script.
 */
export function parseCliArgs(argv: readonly string[]): HideAppsCliOptions {
  const options: HideAppsCliOptions = {
    uiHost: '127.0.0.1',
    uiPort: 3333,
    filter: 'all',
    method: 'auto',
    listOnly: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-3':
      case '--third-party':
        options.filter = 'user';
        break;
      case '-l':
      case '--launcher':
        options.filter = 'launcher';
        break;
      case '--list':
        options.listOnly = true;
        break;
      case '-s':
      case '--serial': {
        const val = argv[++i];
        if (!val) throw new Error(`Missing value for ${arg}`);
        options.serial = val;
        break;
      }
      case '--host': {
        const val = argv[++i];
        if (!val) throw new Error('Missing value for --host');
        options.host = val;
        break;
      }
      case '--port': {
        const val = argv[++i];
        if (!val || !/^\d+$/.test(val)) throw new Error('Invalid value for --port');
        options.port = Number(val);
        break;
      }
      case '--ui-port':
      case '--listen-port': {
        const val = argv[++i];
        if (!val || !/^\d+$/.test(val)) throw new Error(`Invalid value for ${arg}`);
        options.uiPort = Number(val);
        break;
      }
      case '--connect': {
        const val = argv[++i];
        if (!val) throw new Error('Missing value for --connect');
        options.connect = val;
        break;
      }
      case '--backend': {
        const val = argv[++i];
        if (val !== 'auto' && val !== 'native' && val !== 'ya-webadb') {
          throw new Error(`Invalid --backend value "${val}" (expected auto, native, or ya-webadb)`);
        }
        options.backend = val;
        break;
      }
      case '--method': {
        const val = argv[++i] as HideMethod | undefined;
        if (!val || !METHODS.includes(val)) {
          throw new Error(`Invalid --method value "${val ?? ''}" (expected ${METHODS.join(', ')})`);
        }
        options.method = val;
        break;
      }
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.serial) {
          options.serial = arg;
        } else {
          throw new Error(`Unexpected positional argument: ${arg}`);
        }
        break;
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`Usage: tsx tasks/hideApps.ts [options] [serial]

Starts a local web UI on http://localhost:3333 connected to Android devices via ADB
to list available applications and hide/disable or unhide/enable them.

Options:
  -s, --serial <serial>       Default target device serial
  --connect <host[:port]>     Connect to a TCP/wireless ADB device on startup
  --host <host>               ADB server host (default: 127.0.0.1)
  --port <port>               ADB server port (default: 5037)
  --ui-port <port>            Web UI listen port on localhost (default: 3333)
  --backend <mode>            ADB backend: auto | native | ya-webadb
  -3, --third-party           Start filtered to third-party packages
  -l, --launcher              Start filtered to apps visible in the phone launcher
  --method <mode>             Default hide method: auto | hide | disable | uninstall
  --list                      Print packages to stdout without starting the web server
  -h, --help                  Show this help message`);
}

async function safeGetPackages(device: DeviceClient, ...flags: string[]): Promise<string[]> {
  try {
    return await device.getPackages(...flags);
  } catch {
    return [];
  }
}

function parsePackageLines(lines: readonly string[]): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const line of lines) {
    const eqIdx = line.lastIndexOf('=');
    if (eqIdx > 0 && line.startsWith('/')) {
      const pkg = line.slice(eqIdx + 1).trim();
      const apkPath = line.slice(0, eqIdx).trim();
      if (pkg) map.set(pkg, apkPath);
    } else if (line.trim()) {
      map.set(line.trim(), undefined);
    }
  }
  return map;
}

function parseLauncherPackagesOutput(raw: string): Set<string> {
  const packages = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = /^([a-zA-Z0-9._-]+)\//.exec(trimmed);
    if (match) {
      packages.add(match[1]);
    }
  }
  return packages;
}

async function safeGetLauncherPackages(device: DeviceClient): Promise<Set<string>> {
  try {
    const out = await device.execOut([
      'cmd',
      'package',
      'query-activities',
      '--components',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
    ], 'utf8');
    if (/Unknown option|IllegalArgumentException/i.test(out)) {
      const fallback = await device.execOut([
        'cmd',
        'package',
        'query-activities',
        '--brief',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.LAUNCHER',
      ], 'utf8');
      return parseLauncherPackagesOutput(fallback);
    }
    return parseLauncherPackagesOutput(out);
  } catch {
    return new Set<string>();
  }
}

/**
 * Load all packages from the device and classify each package's state, kind, launcher visibility, and APK path.
 */
export async function loadDevicePackages(device: DeviceClient): Promise<AppEntry[]> {
  const [allWithUninstalled, enabledList, disabledList, thirdPartyList, systemList, launcherSet] = await Promise.all([
    safeGetPackages(device, '-f', '-u'),
    safeGetPackages(device, '-e'),
    safeGetPackages(device, '-d'),
    safeGetPackages(device, '-3'),
    safeGetPackages(device, '-s'),
    safeGetLauncherPackages(device),
  ]);

  const pathMap = parsePackageLines(allWithUninstalled);
  const enabled = new Set(enabledList);
  const disabled = new Set(disabledList);
  const thirdParty = new Set(thirdPartyList);
  const system = new Set(systemList);
  const allNames = new Set([
    ...pathMap.keys(),
    ...enabledList,
    ...disabledList,
    ...thirdPartyList,
    ...systemList,
  ]);

  if (allNames.size === 0) {
    for (const pkg of await device.getPackages()) {
      allNames.add(pkg);
      enabled.add(pkg);
    }
  }

  const apps: AppEntry[] = [];
  for (const name of allNames) {
    let state: AppState;
    if (enabled.has(name)) {
      state = 'enabled';
    } else if (disabled.has(name)) {
      state = 'disabled';
    } else {
      state = 'hidden';
    }

    const kind: AppKind = thirdParty.has(name) ? 'user' : system.has(name) ? 'system' : 'system';
    const apkPath = pathMap.get(name);
    const entry: AppEntry = { name, state, kind };
    if (launcherSet.has(name)) entry.inLauncher = true;
    if (apkPath) entry.apkPath = apkPath;
    apps.push(entry);
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
}

/**
 * Filter applications by category/state filter and case-insensitive search against label or package name.
 */
export function filterPackages(apps: readonly AppEntry[], filter: AppFilter, query: string): AppEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  return apps.filter((app) => {
    switch (filter) {
      case 'launcher':
        if (!app.inLauncher) return false;
        break;
      case 'user':
        if (app.kind !== 'user') return false;
        break;
      case 'system':
        if (app.kind !== 'system') return false;
        break;
      case 'inactive':
        if (app.state === 'enabled') return false;
        break;
      case 'enabled':
        if (app.state !== 'enabled') return false;
        break;
      case 'all':
        break;
    }
    if (normalizedQuery) {
      const matchesPkg = app.name.toLowerCase().includes(normalizedQuery);
      const matchesLabel = app.label?.toLowerCase().includes(normalizedQuery) ?? false;
      if (!matchesPkg && !matchesLabel) return false;
    }
    return true;
  });
}

interface ShellCommandCheck {
  ok: boolean;
  output: string;
  isPermissionError: boolean;
  isUnsupportedOption: boolean;
}

async function runShellCommand(device: DeviceClient, args: string[]): Promise<ShellCommandCheck> {
  const raw = await device.execOut(args, 'utf8');
  const output = raw.trim();
  const isPermissionError = /SecurityException|MANAGE_USERS|Neither user|Permission Denial|not allowed to|Cannot (?:disable|hide)/i.test(output);
  const isUnsupportedOption = /Unknown option|Error: unknown|illegal option/i.test(output);
  const hasFailure = isPermissionError
    || isUnsupportedOption
    || /(?:^|\n)\s*(?:Error:|Exception|Failure|Unknown package:|java\.lang\.)/i.test(output);
  return {
    ok: !hasFailure,
    output,
    isPermissionError,
    isUnsupportedOption,
  };
}

async function runPmWithOptionalUser(device: DeviceClient, subcommand: string, pkg: string): Promise<ShellCommandCheck> {
  const withUser = await runShellCommand(device, ['pm', subcommand, '--user', '0', pkg]);
  if (withUser.ok || !withUser.isUnsupportedOption) {
    return withUser;
  }
  return runShellCommand(device, ['pm', subcommand, pkg]);
}

async function runUninstallForUser0(device: DeviceClient, pkg: string): Promise<ShellCommandCheck> {
  return runShellCommand(device, ['pm', 'uninstall', '-k', '--user', '0', pkg]);
}

/**
 * Hide or disable an application on the connected Android device.
 */
export async function hidePackage(device: DeviceClient, pkg: string, method: HideMethod): Promise<PmActionResult> {
  if (method === 'uninstall') {
    const uninstallResult = await runUninstallForUser0(device, pkg);
    if (uninstallResult.ok) {
      return {
        state: 'hidden',
        methodUsed: 'pm uninstall -k --user 0',
        message: `Hid ${pkg} via pm uninstall -k --user 0`,
      };
    }
    throw new Error(uninstallResult.output || `pm uninstall -k --user 0 failed for ${pkg}`);
  }

  if (method === 'hide' || method === 'auto') {
    const hideResult = await runPmWithOptionalUser(device, 'hide', pkg);
    if (hideResult.ok && !/new hidden state:\s*false/i.test(hideResult.output)) {
      return {
        state: 'hidden',
        methodUsed: 'pm hide',
        message: `Hid ${pkg} via pm hide`,
      };
    }
    if (method === 'hide') {
      throw new Error(hideResult.output || `pm hide failed for ${pkg}`);
    }
  }

  const disableResult = await runPmWithOptionalUser(device, 'disable-user', pkg);
  if (disableResult.ok) {
    return {
      state: 'disabled',
      methodUsed: 'pm disable-user',
      message: method === 'auto'
        ? `Hid ${pkg} via pm disable-user (pm hide requires MANAGE_USERS/root)`
        : `Disabled ${pkg} via pm disable-user`,
    };
  }

  if (method === 'auto' && disableResult.isPermissionError) {
    const uninstallResult = await runUninstallForUser0(device, pkg);
    if (uninstallResult.ok) {
      return {
        state: 'hidden',
        methodUsed: 'pm uninstall -k --user 0',
        message: `Hid ${pkg} via pm uninstall -k --user 0 (system package cannot be disabled directly)`,
      };
    }
    throw new Error(uninstallResult.output || disableResult.output || `Failed to hide/uninstall ${pkg}`);
  }

  throw new Error(disableResult.output || `Failed to hide/disable ${pkg}`);
}

/**
 * Unhide, re-enable, or reinstall an application for user 0 on the connected device.
 */
export async function unhidePackage(
  device: DeviceClient,
  pkg: string,
  currentState: AppState,
  method: HideMethod,
): Promise<PmActionResult> {
  if (currentState === 'disabled') {
    const enableResult = await runPmWithOptionalUser(device, 'enable', pkg);
    if (enableResult.ok) {
      return {
        state: 'enabled',
        methodUsed: 'pm enable',
        message: `Unhid/enabled ${pkg} via pm enable`,
      };
    }
    throw new Error(enableResult.output || `pm enable failed for ${pkg}`);
  }

  if (method === 'uninstall') {
    const installResult = await runShellCommand(device, ['cmd', 'package', 'install-existing', '--user', '0', pkg]);
    if (installResult.ok) {
      return {
        state: 'enabled',
        methodUsed: 'cmd package install-existing',
        message: `Restored ${pkg} via cmd package install-existing`,
      };
    }
    const fallbackInstall = await runShellCommand(device, ['cmd', 'package', 'install-existing', pkg]);
    if (fallbackInstall.ok) {
      return {
        state: 'enabled',
        methodUsed: 'cmd package install-existing',
        message: `Restored ${pkg} via cmd package install-existing`,
      };
    }
    throw new Error(installResult.output || fallbackInstall.output || `Failed to restore ${pkg}`);
  }

  const unhideResult = await runPmWithOptionalUser(device, 'unhide', pkg);
  if (unhideResult.ok) {
    return {
      state: 'enabled',
      methodUsed: 'pm unhide',
      message: `Unhid ${pkg} via pm unhide`,
    };
  }

  if (method === 'auto' || method === 'disable') {
    const installResult = await runShellCommand(device, ['cmd', 'package', 'install-existing', '--user', '0', pkg]);
    if (installResult.ok) {
      await runPmWithOptionalUser(device, 'enable', pkg);
      return {
        state: 'enabled',
        methodUsed: 'cmd package install-existing',
        message: `Restored ${pkg} via cmd package install-existing`,
      };
    }
    const enableResult = await runPmWithOptionalUser(device, 'enable', pkg);
    if (enableResult.ok) {
      return {
        state: 'enabled',
        methodUsed: 'pm enable',
        message: `Enabled ${pkg} via pm enable`,
      };
    }
  }

  throw new Error(unhideResult.output || `Failed to unhide ${pkg}`);
}

/**
 * Try to fully uninstall a package, falling back to `--user 0` uninstall for system apps.
 */
export async function uninstallPackage(device: DeviceClient, pkg: string): Promise<PmActionResult> {
  const fullResult = await runShellCommand(device, ['pm', 'uninstall', pkg]);
  if (fullResult.ok) {
    return {
      removed: true,
      state: 'hidden',
      methodUsed: 'pm uninstall',
      message: `Uninstalled ${pkg}`,
    };
  }

  const userZeroResult = await runShellCommand(device, ['pm', 'uninstall', '--user', '0', pkg]);
  if (userZeroResult.ok) {
    return {
      removed: false,
      state: 'hidden',
      methodUsed: 'pm uninstall --user 0',
      message: `Uninstalled ${pkg} for user 0 (system app remains on /system)`,
    };
  }

  throw new Error(userZeroResult.output || fullResult.output || `Failed to uninstall ${pkg}`);
}

async function isTcpPortReachable(host: string, port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export function isUsbBusyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /claimInterface|exclusive access|LIBUSB_ERROR_BUSY|0xe00002c5|usb.*busy/i.test(msg);
}

export function extractDeviceAbis(props: Record<string, string | undefined>): {
  abi: string;
  abiList: string[];
} {
  const abiList: string[] = [];
  const push = (raw?: string) => {
    if (!raw) return;
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (trimmed && !abiList.includes(trimmed)) {
        abiList.push(trimmed);
      }
    }
  };
  push(props['ro.product.cpu.abi']);
  push(props['ro.product.cpu.abilist']);
  push(props['ro.product.cpu.abilist64']);
  push(props['ro.product.cpu.abilist32']);
  push(props['ro.product.cpu.abi2']);
  return {
    abi: abiList[0] || '',
    abiList,
  };
}

export async function fetchDeviceSummary(device: DeviceClient): Promise<DeviceSummary> {
  try {
    const props = await device.getProperties();
    const { abi, abiList } = extractDeviceAbis(props);
    return {
      serial: device.serial,
      model: props['ro.product.model'] || props['ro.product.device'] || '',
      androidVersion: props['ro.build.version.release'] || '',
      sdk: props['ro.build.version.sdk'] || '',
      abi,
      abiList,
    };
  } catch {
    return {
      serial: device.serial,
      model: '',
      androidVersion: '',
      sdk: '',
      abi: '',
      abiList: [],
    };
  }
}

export interface AdbSession {
  runWithClient<T>(fn: (client: ReturnType<typeof createClient>) => Promise<T>): Promise<T>;
}

export function createAdbSession(options: Pick<HideAppsCliOptions, 'host' | 'port' | 'backend'>): AdbSession {
  let forceNative = options.backend === 'native';

  const makeClient = (backend: AdbOptions['backend']) => createClient({
    host: options.host,
    port: options.port,
    backend,
  });

  return {
    async runWithClient<T>(fn: (client: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
      let backend = options.backend;
      if (forceNative) {
        backend = 'native';
      } else if (!backend || backend === 'auto') {
        const host = options.host || process.env.ADB_HOST || '127.0.0.1';
        const envPort = process.env.ADB_PORT ? Number.parseInt(process.env.ADB_PORT, 10) : NaN;
        const port = options.port ?? (Number.isNaN(envPort) ? 5037 : envPort);
        if (await isTcpPortReachable(host, port)) {
          backend = 'native';
        }
      }

      try {
        return await fn(makeClient(backend));
      } catch (err) {
        if ((!options.backend || options.backend === 'auto') && backend !== 'native' && isUsbBusyError(err)) {
          forceNative = true;
          await YaWebAdbManager.getInstance().killAll().catch(() => {});
          return fn(makeClient('native'));
        }
        throw err;
      }
    },
  };
}

/**
 * Shared CSS rules for the APK drag-and-drop sideload zone.
 */
export const APK_DROPZONE_CSS = `
    .visually-hidden {
      position: absolute;
      clip-path: inset(50%);
      overflow: hidden;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      white-space: nowrap;
    }

    .dropzone {
      background: var(--surface);
      border: 2px dashed var(--border);
      border-radius: 12px;
      padding: 0.9rem 1.1rem;
      display: grid;
      gap: 0.6rem;
      transition: border-color 0.15s ease, background-color 0.15s ease;
    }

    .dropzone[data-drag-over="true"] {
      border-color: var(--brand);
      background: color-mix(in srgb, var(--brand) 10%, var(--surface));
    }

    .dropzone-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .dropzone-copy {
      display: grid;
      gap: 0.15rem;
      min-inline-size: 0;
    }

    .dropzone-hint {
      font-size: 0.85rem;
      color: var(--muted);
    }

    .dropzone-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
`;

/**
 * Render semantic HTML for the APK drag-and-drop sideload zone.
 */
export function renderApkDropzoneHtml(): string {
  return `    <section class="dropzone" id="apk-dropzone" aria-label="Sideload APK">
      <div class="dropzone-row">
        <div class="dropzone-copy">
          <strong>Sideload APK (Drag &amp; Drop)</strong>
          <span class="dropzone-hint" id="apk-drop-hint">Drop an <code>.apk</code> file here to sideload onto the connected device.</span>
        </div>
        <div class="dropzone-controls">
          <label for="apk-file-input" class="visually-hidden">Choose APK file to sideload</label>
          <input type="file" id="apk-file-input" name="apk" class="visually-hidden" accept=".apk,application/vnd.android.package-archive">
          <button type="button" id="apk-browse-btn">Choose .apk…</button>
        </div>
      </div>
      <progress id="apk-progress" max="100" aria-label="APK upload and install progress" hidden></progress>
    </section>`;
}

/**
 * Render the client script binding drag-and-drop and file selection to `/api/packages/install`.
 */
export function renderApkDropzoneScript(refreshUiExpr: string, syncUiExpr: string): string {
  return `      (() => {
        const apkDropzone = document.getElementById('apk-dropzone');
        const apkDropHint = document.getElementById('apk-drop-hint');
        const apkFileInput = document.getElementById('apk-file-input');
        const apkBrowseBtn = document.getElementById('apk-browse-btn');
        const apkProgress = document.getElementById('apk-progress');
        if (!apkDropzone || !apkDropHint || !apkFileInput || !apkBrowseBtn || !apkProgress) return;

        const DEFAULT_DROP_HINT = 'Drop an .apk file here to sideload onto the connected device.';
        let dragDepth = 0;

        function setDragActive(active) {
          if (active) {
            apkDropzone.dataset.dragOver = 'true';
            if (!state.busy) {
              apkDropHint.textContent = state.serial
                ? 'Release to sideload onto ' + state.serial + '.'
                : 'Select or connect a target device first.';
            }
          } else {
            delete apkDropzone.dataset.dragOver;
            if (!state.busy) {
              apkDropHint.textContent = DEFAULT_DROP_HINT;
            }
          }
        }

        async function sideloadApkFile(file) {
          if (!file) return;
          if (!state.serial) {
            setStatus('No connected Android device selected.', 'error');
            return;
          }
          if (state.busy) {
            setStatus('Wait for the current operation to finish before sideloading.', 'warn');
            return;
          }
          if (!file.name.toLowerCase().endsWith('.apk')) {
            setStatus('Unsupported file "' + file.name + '": only .apk files can be sideloaded.', 'error');
            return;
          }

          state.busy = true;
          ${syncUiExpr}
          apkBrowseBtn.disabled = true;
          apkProgress.hidden = false;
          apkProgress.max = 100;
          apkProgress.value = 0;
          apkDropHint.textContent = 'Uploading ' + file.name + ' (0%)…';
          setStatus('Uploading ' + file.name + '…', 'info');

          try {
            const result = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', '/api/packages/install?serial=' + encodeURIComponent(state.serial) + '&filename=' + encodeURIComponent(file.name));
              xhr.setRequestHeader('Content-Type', 'application/octet-stream');
              const switchToInstalling = () => {
                apkProgress.removeAttribute('value');
                apkDropHint.textContent = 'Installing ' + file.name + ' on ' + state.serial + ' via ADB…';
                setStatus('Installing ' + file.name + ' on ' + state.serial + '…', 'info');
              };
              xhr.upload.addEventListener('progress', (e) => {
                if (!e.lengthComputable || e.total <= 0) return;
                const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
                apkProgress.value = pct;
                if (pct < 100) {
                  apkDropHint.textContent = 'Uploading ' + file.name + ' (' + pct + '%)…';
                } else {
                  switchToInstalling();
                }
              });
              xhr.upload.addEventListener('load', switchToInstalling);
              xhr.addEventListener('load', () => {
                let data = {};
                try {
                  data = JSON.parse(xhr.responseText || '{}');
                } catch {
                  data = {};
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                  resolve(data);
                } else {
                  reject(new Error(data.error || ('Sideload failed (HTTP ' + xhr.status + ')')));
                }
              });
              xhr.addEventListener('error', () => reject(new Error('Network error while uploading APK')));
              xhr.addEventListener('abort', () => reject(new Error('APK upload aborted')));
              xhr.send(file);
            });

            state.busy = false;
            ${refreshUiExpr}
            setStatus(result.message || ('Sideloaded ' + file.name + '.'), 'success');
          } catch (err) {
            setStatus(err instanceof Error ? err.message : String(err), 'error');
          } finally {
            state.busy = false;
            apkProgress.hidden = true;
            apkProgress.value = 0;
            apkBrowseBtn.disabled = false;
            apkFileInput.value = '';
            apkDropHint.textContent = DEFAULT_DROP_HINT;
            ${syncUiExpr}
          }
        }

        apkBrowseBtn.addEventListener('click', () => apkFileInput.click());
        apkFileInput.addEventListener('change', () => {
          const file = apkFileInput.files && apkFileInput.files[0];
          if (file) void sideloadApkFile(file);
        });

        window.addEventListener('dragenter', (e) => {
          if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
            e.preventDefault();
            dragDepth++;
            setDragActive(true);
          }
        });
        window.addEventListener('dragover', (e) => {
          if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        });
        window.addEventListener('dragleave', (e) => {
          if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) setDragActive(false);
          }
        });
        window.addEventListener('drop', (e) => {
          const files = e.dataTransfer && e.dataTransfer.files;
          if (!files || files.length === 0) return;
          e.preventDefault();
          dragDepth = 0;
          setDragActive(false);
          void sideloadApkFile(files[0]);
        });
      })();`;
}

/**
 * Render the single-page web GUI HTML document with a per-request CSP nonce.
 */
export function renderWebPage(nonce: string, initialOptions: Pick<HideAppsCliOptions, 'serial' | 'filter' | 'method'>): string {
  const initialConfig = JSON.stringify({
    serial: initialOptions.serial ?? '',
    filter: initialOptions.filter,
    method: initialOptions.method,
    criticalPackages: [...CRITICAL_PACKAGES],
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>adbkit — Android App Hider</title>
  <style nonce="${nonce}">
    :root {
      --bg-light: #f5f7fb;
      --bg-dark: #0f141b;
      --surface-light: #ffffff;
      --surface-dark: #18202c;
      --surface-alt-light: #eef2f7;
      --surface-alt-dark: #202b3a;
      --border-light: #d6deea;
      --border-dark: #2b394d;
      --text-light: #131c28;
      --text-dark: #eaf0f7;
      --muted-light: #526277;
      --muted-dark: #9fb0c6;
      --brand-light: #1a56db;
      --brand-dark: #5fa3ff;
      --brand-text-light: #ffffff;
      --brand-text-dark: #091322;
      --ok-light: #157347;
      --ok-dark: #5ad19a;
      --warn-light: #9a5b00;
      --warn-dark: #f7b955;
      --danger-light: #b42318;
      --danger-dark: #ff7b72;
      --scrollbar-track-light: #e7ecf3;
      --scrollbar-track-dark: #121821;
      --scrollbar-thumb-light: #7c8ca3;
      --scrollbar-thumb-dark: #5e718d;

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

    .app-shell {
      max-inline-size: 1180px;
      margin-inline: auto;
      padding: 1.25rem;
      display: grid;
      gap: 1rem;
    }

    header {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.25rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    header > div:first-child {
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

    .device-bar {
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

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.75rem;
    }

    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.75rem 1rem;
    }

    .stat-label {
      display: block;
      font-size: 0.8rem;
      color: var(--muted);
    }

    .stat-value {
      font-size: 1.35rem;
      font-weight: 700;
    }

    .toolbar {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem;
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
      flex: 2 1 260px;
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

    .batch-actions {
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

    .status-banner[data-kind="success"] {
      border-left-color: var(--ok);
    }

    .status-banner[data-kind="error"] {
      border-left-color: var(--danger);
    }

    .status-banner[data-kind="warn"] {
      border-left-color: var(--warn);
    }

    .status-banner[data-kind="info"] {
      border-left-color: var(--brand);
    }

    .table-wrapper {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: auto;
      max-inline-size: 100%;
      max-block-size: min(620px, 68vh);
      container-type: inline-size;
    }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      --label-1: "Select";
      --label-2: "Application";
      --label-3: "Type";
      --label-4: "Status";
      --label-5: "Action";
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
      padding: 0.65rem 0.9rem;
      border-bottom: 1px solid var(--border);
      text-align: start;
      vertical-align: middle;
    }

    tbody th {
      position: sticky;
      inset-inline-start: 0;
      z-index: 1;
      background: var(--surface);
      max-inline-size: 480px;
    }

    .app-cell {
      display: flex;
      align-items: center;
      gap: 0.75rem;
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
      font-size: 0.94rem;
      font-weight: 600;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .app-pkg {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      font-weight: 400;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    tbody tr:hover td,
    tbody tr:hover th {
      background: var(--surface-alt);
    }

    .badge {
      display: inline-block;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 700;
      border: 1px solid currentColor;
      white-space: nowrap;
    }

    .badge[data-state="enabled"] {
      color: var(--ok);
    }

    .badge[data-state="disabled"] {
      color: var(--warn);
    }

    .badge[data-state="hidden"] {
      color: var(--danger);
    }

    .badge[data-kind="user"] {
      color: var(--brand);
    }

    .badge[data-kind="system"] {
      color: var(--muted);
    }

    .badge[data-kind="launcher"] {
      color: var(--ok);
      margin-inline-start: 0.35rem;
    }

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

    @container (width < 640px) {
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
        white-space: normal;
        word-break: break-all;
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

    .connect-form {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
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

${APK_DROPZONE_CSS}
  </style>
</head>
<body>
  <div class="app-shell">
    <header>
      <div>
        <h1>adbkit — Android App Hider</h1>
        <p class="subtitle" id="device-meta">Connecting to ADB…</p>
        <p class="arch-meta" id="device-arch" hidden></p>
      </div>
      <div class="device-bar">
        <label for="device-select">Device</label>
        <select id="device-select" aria-label="Android device"></select>
        <button type="button" id="refresh-btn">Refresh</button>
      </div>
    </header>

    <section class="stats-grid" aria-label="Package summary">
      <div class="stat-card"><span class="stat-label">Total</span><span class="stat-value" id="stat-total">0</span></div>
      <div class="stat-card"><span class="stat-label">Enabled</span><span class="stat-value" id="stat-enabled">0</span></div>
      <div class="stat-card"><span class="stat-label">Hidden / Disabled</span><span class="stat-value" id="stat-hidden">0</span></div>
      <div class="stat-card"><span class="stat-label">Shown</span><span class="stat-value" id="stat-shown">0</span></div>
    </section>

    <section class="toolbar" aria-label="Filters and actions">
      <search>
        <form id="filter-form">
          <div class="field grow">
            <label for="search-input">Search packages</label>
            <input type="search" id="search-input" placeholder="e.g. bixby, facebook, com.xiaomi…">
          </div>
          <div class="field">
            <label for="filter-select">Filter</label>
            <select id="filter-select">
              <option value="all">All packages</option>
              <option value="launcher">Visible in launcher</option>
              <option value="user">3rd-party only</option>
              <option value="system">System only</option>
              <option value="inactive">Hidden / Disabled</option>
              <option value="enabled">Enabled only</option>
            </select>
          </div>
          <div class="field">
            <label for="method-select">Hide method</label>
            <select id="method-select">
              <option value="auto">auto (hide → disable-user → uninstall -k --user 0)</option>
              <option value="hide">pm hide (root / MANAGE_USERS)</option>
              <option value="disable">pm disable-user</option>
              <option value="uninstall">pm uninstall -k --user 0</option>
            </select>
          </div>
        </form>
      </search>

      <div class="batch-bar">
        <form class="connect-form" id="connect-form">
          <label for="connect-input">Wi-Fi ADB</label>
          <input type="text" id="connect-input" placeholder="192.168.1.50:5555">
          <button type="submit">Connect</button>
        </form>
        <div class="batch-actions">
          <button type="button" id="hide-selected-btn" class="danger" disabled>Hide selected (0)</button>
          <button type="button" id="unhide-selected-btn" class="primary" disabled>Unhide selected (0)</button>
          <button type="button" id="uninstall-selected-btn" class="danger" disabled>Uninstall selected (0)</button>
          <button type="button" id="clear-selected-btn" disabled>Clear</button>
        </div>
      </div>
    </section>

${renderApkDropzoneHtml()}

    <div class="status-banner" id="status-banner" data-kind="info" role="status" aria-live="polite">
      Loading connected devices…
    </div>

    <main>
      <div tabindex="0" role="region" aria-labelledby="apps-table-caption" class="table-wrapper">
        <table>
          <caption id="apps-table-caption">Installed Android applications</caption>
          <thead>
            <tr>
              <th><input type="checkbox" id="select-all-cb" aria-label="Select all visible packages"></th>
              <th>Application</th>
              <th>Type</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="apps-tbody">
            <tr><td colspan="5" class="empty-cell">Loading packages…</td></tr>
          </tbody>
        </table>
      </div>
    </main>
  </div>

  <dialog id="confirm-dialog" closedby="any" aria-labelledby="confirm-title">
    <h2 id="confirm-title">Confirm action</h2>
    <p id="confirm-body"></p>
    <form method="dialog">
      <button value="cancel" autofocus>Cancel</button>
      <button value="confirm" class="primary">Confirm</button>
    </form>
  </dialog>

  <script nonce="${nonce}">
    (() => {
      const INITIAL = ${initialConfig};
      const criticalSet = new Set(INITIAL.criticalPackages);
      const state = {
        serial: INITIAL.serial,
        apps: [],
        filtered: [],
        selected: new Set(),
        metaLoaded: new Set(),
        metaRunId: 0,
        rowRefs: new Map(),
        busy: false,
      };

      const deviceSelect = document.getElementById('device-select');
      const deviceMeta = document.getElementById('device-meta');
      const deviceArch = document.getElementById('device-arch');
      const refreshBtn = document.getElementById('refresh-btn');
      const searchInput = document.getElementById('search-input');
      const filterSelect = document.getElementById('filter-select');
      const methodSelect = document.getElementById('method-select');
      const filterForm = document.getElementById('filter-form');
      const connectForm = document.getElementById('connect-form');
      const connectInput = document.getElementById('connect-input');
      const selectAllCb = document.getElementById('select-all-cb');
      const hideSelectedBtn = document.getElementById('hide-selected-btn');
      const unhideSelectedBtn = document.getElementById('unhide-selected-btn');
      const uninstallSelectedBtn = document.getElementById('uninstall-selected-btn');
      const clearSelectedBtn = document.getElementById('clear-selected-btn');
      const statusBanner = document.getElementById('status-banner');
      const tbody = document.getElementById('apps-tbody');
      const statTotal = document.getElementById('stat-total');
      const statEnabled = document.getElementById('stat-enabled');
      const statHidden = document.getElementById('stat-hidden');
      const statShown = document.getElementById('stat-shown');
      const confirmDialog = document.getElementById('confirm-dialog');
      const confirmTitle = document.getElementById('confirm-title');
      const confirmBody = document.getElementById('confirm-body');

      filterSelect.value = INITIAL.filter;
      methodSelect.value = INITIAL.method;

      if (!('closedBy' in HTMLDialogElement.prototype)) {
        const outside = (e, dialog) => {
          const r = dialog.getBoundingClientRect();
          return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        };
        let pressedOutside = false;
        confirmDialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, confirmDialog); });
        confirmDialog.addEventListener('pointerup', (e) => {
          if (pressedOutside && outside(e, confirmDialog)) confirmDialog.close();
        });
      }

      function renderDeviceArch(summary) {
        deviceArch.replaceChildren();
        const abiList = summary && Array.isArray(summary.abiList) ? summary.abiList : [];
        const primary = (summary && summary.abi) || abiList[0] || '';
        if (!primary && abiList.length === 0) {
          deviceArch.hidden = true;
          return;
        }
        const label = document.createElement('span');
        label.textContent = 'CPU / APK ABI:';
        deviceArch.appendChild(label);

        const abis = abiList.length > 0 ? abiList : [primary];
        abis.forEach((abi, idx) => {
          const code = document.createElement('code');
          code.className = idx === 0 ? 'abi-chip primary' : 'abi-chip';
          code.textContent = idx === 0 && abis.length > 1 ? abi + ' (primary)' : abi;
          deviceArch.appendChild(code);
        });
        deviceArch.hidden = false;
      }

      function setStatus(message, kind = 'info') {
        statusBanner.textContent = message;
        statusBanner.dataset.kind = kind;
      }

      function askConfirmation(title, body) {
        confirmTitle.textContent = title;
        confirmBody.textContent = body;
        return new Promise((resolve) => {
          confirmDialog.addEventListener('close', () => {
            const accepted = confirmDialog.returnValue === 'confirm';
            confirmDialog.returnValue = '';
            resolve(accepted);
          }, { once: true });
          confirmDialog.showModal();
        });
      }

      function applyFilter() {
        const filter = filterSelect.value;
        const query = searchInput.value.trim().toLowerCase();
        state.filtered = state.apps.filter((app) => {
          if (filter === 'launcher' && !app.inLauncher) return false;
          if (filter === 'user' && app.kind !== 'user') return false;
          if (filter === 'system' && app.kind !== 'system') return false;
          if (filter === 'inactive' && app.state === 'enabled') return false;
          if (filter === 'enabled' && app.state !== 'enabled') return false;
          if (query) {
            const matchName = app.name.toLowerCase().includes(query);
            const matchLabel = app.label ? app.label.toLowerCase().includes(query) : false;
            if (!matchName && !matchLabel) return false;
          }
          return true;
        });
        renderTable();
        updateStats();
      }

      function updateStats() {
        const enabled = state.apps.filter((a) => a.state === 'enabled').length;
        statTotal.textContent = String(state.apps.length);
        statEnabled.textContent = String(enabled);
        statHidden.textContent = String(state.apps.length - enabled);
        statShown.textContent = String(state.filtered.length);

        const count = state.selected.size;
        hideSelectedBtn.textContent = 'Hide selected (' + count + ')';
        unhideSelectedBtn.textContent = 'Unhide selected (' + count + ')';
        uninstallSelectedBtn.textContent = 'Uninstall selected (' + count + ')';
        hideSelectedBtn.disabled = state.busy || count === 0;
        unhideSelectedBtn.disabled = state.busy || count === 0;
        uninstallSelectedBtn.disabled = state.busy || count === 0;
        clearSelectedBtn.disabled = state.busy || count === 0;

        const visibleSelected = state.filtered.length > 0 && state.filtered.every((a) => state.selected.has(a.name));
        const someSelected = state.filtered.some((a) => state.selected.has(a.name));
        selectAllCb.checked = visibleSelected;
        selectAllCb.indeterminate = !visibleSelected && someSelected;
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
            const fallback = createFallbackIconNode(app);
            img.replaceWith(fallback);
          }, { once: true });
          return img;
        }
        return createFallbackIconNode(app);
      }

      function createFallbackIconNode(app) {
        const span = document.createElement('span');
        span.className = 'app-icon-fallback';
        span.setAttribute('aria-hidden', 'true');
        const source = (app.label || app.name.split('.').pop() || app.name).trim();
        span.textContent = source.slice(0, 1).toUpperCase() || '?';
        return span;
      }

      function updateRowMeta(app) {
        const ref = state.rowRefs.get(app.name);
        if (!ref) return;
        ref.labelEl.textContent = app.label || app.name;
        const currentIsImg = ref.iconSlot.tagName === 'IMG';
        if (app.hasIcon && !currentIsImg) {
          const newIcon = createIconNode(app);
          ref.iconSlot.replaceWith(newIcon);
          ref.iconSlot = newIcon;
        } else if (!app.hasIcon && !currentIsImg) {
          const source = (app.label || app.name.split('.').pop() || app.name).trim();
          ref.iconSlot.textContent = source.slice(0, 1).toUpperCase() || '?';
        }
      }

      function renderTable() {
        tbody.replaceChildren();
        state.rowRefs.clear();
        if (state.filtered.length === 0) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 5;
          td.className = 'empty-cell';
          td.textContent = state.serial ? 'No applications match the current filter.' : 'No Android device selected.';
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
            updateStats();
          });
          tdCheck.appendChild(cb);

          const thPkg = document.createElement('th');
          thPkg.scope = 'row';
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
          thPkg.appendChild(cell);

          state.rowRefs.set(app.name, { iconSlot, labelEl });

          const tdType = document.createElement('td');
          const kindBadge = document.createElement('span');
          kindBadge.className = 'badge';
          kindBadge.dataset.kind = app.kind;
          kindBadge.textContent = app.kind === 'user' ? '3rd-party' : 'system';
          tdType.appendChild(kindBadge);
          if (app.inLauncher) {
            const launcherBadge = document.createElement('span');
            launcherBadge.className = 'badge';
            launcherBadge.dataset.kind = 'launcher';
            launcherBadge.textContent = 'launcher';
            tdType.appendChild(launcherBadge);
          }

          const tdStatus = document.createElement('td');
          const statusBadge = document.createElement('span');
          statusBadge.className = 'badge';
          statusBadge.dataset.state = app.state;
          statusBadge.textContent = app.state;
          tdStatus.appendChild(statusBadge);

          const tdAction = document.createElement('td');
          const rowActions = document.createElement('div');
          rowActions.className = 'row-actions';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.disabled = state.busy;
          if (app.state === 'enabled') {
            btn.className = 'danger';
            btn.textContent = 'Hide';
            btn.addEventListener('click', () => runAction('hide', [app]));
          } else {
            btn.className = 'primary';
            btn.textContent = 'Unhide';
            btn.addEventListener('click', () => runAction('unhide', [app]));
          }
          const uninstallBtn = document.createElement('button');
          uninstallBtn.type = 'button';
          uninstallBtn.className = 'danger';
          uninstallBtn.textContent = 'Uninstall';
          uninstallBtn.disabled = state.busy;
          uninstallBtn.addEventListener('click', () => runAction('uninstall', [app]));
          rowActions.append(btn, uninstallBtn);
          tdAction.appendChild(rowActions);

          tr.append(tdCheck, thPkg, tdType, tdStatus, tdAction);
          frag.appendChild(tr);
        }
        tbody.appendChild(frag);
      }

      async function loadAppMetadataInBackground(serial, runId) {
        const priorityQueue = [
          ...state.filtered.filter((a) => !state.metaLoaded.has(a.name)),
          ...state.apps.filter((a) => a.inLauncher && !state.metaLoaded.has(a.name)),
          ...state.apps.filter((a) => a.kind === 'user' && !state.metaLoaded.has(a.name)),
          ...state.apps.filter((a) => a.kind !== 'user' && !state.metaLoaded.has(a.name)),
        ];
        const seen = new Set();
        const queue = [];
        for (const app of priorityQueue) {
          if (!seen.has(app.name)) {
            seen.add(app.name);
            queue.push(app);
          }
        }

        const byName = new Map(state.apps.map((a) => [a.name, a]));
        const batchSize = 12;
        for (let i = 0; i < queue.length; i += batchSize) {
          if (state.metaRunId !== runId || state.serial !== serial) return;
          const batch = queue.slice(i, i + batchSize);
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
                entry.hasIcon = Boolean(item.hasIcon);
                updateRowMeta(entry);
              }
            }
          } catch {
            break;
          }
        }
      }

      async function loadDevicesAndPackages(preferredSerial) {
        state.busy = true;
        updateStats();
        try {
          const devRes = await fetch('/api/devices');
          const devData = await devRes.json();
          if (!devRes.ok) throw new Error(devData.error || 'Failed to list devices');

          deviceSelect.replaceChildren();
          for (const dev of devData.devices) {
            const opt = document.createElement('option');
            opt.value = dev.id;
            opt.textContent = (dev.model ? dev.model + ' — ' : '') + dev.id + ' (' + dev.type + ')';
            deviceSelect.appendChild(opt);
          }

          const ready = devData.devices.filter((d) => d.type === 'device' || d.type === 'emulator');
          const chosen = preferredSerial || state.serial || devData.defaultSerial || (ready[0] ? ready[0].id : '');
          state.serial = chosen;
          if (chosen) deviceSelect.value = chosen;

          if (!state.serial) {
            state.apps = [];
            deviceMeta.textContent = 'No ready Android devices connected.';
            renderDeviceArch(null);
            setStatus('Connect an Android phone with USB debugging enabled and click Refresh.', 'warn');
            applyFilter();
            return;
          }

          setStatus('Loading packages from ' + state.serial + '…', 'info');
          const pkgRes = await fetch('/api/packages?serial=' + encodeURIComponent(state.serial));
          const pkgData = await pkgRes.json();
          if (!pkgRes.ok) throw new Error(pkgData.error || 'Failed to load packages');

          state.apps = pkgData.apps;
          state.metaLoaded = new Set(
            state.apps.filter((a) => a.label || a.hasIcon).map((a) => a.name),
          );
          const existing = new Set(state.apps.map((a) => a.name));
          for (const name of [...state.selected]) {
            if (!existing.has(name)) state.selected.delete(name);
          }

          const s = pkgData.summary;
          deviceMeta.textContent = (s.model || s.serial) + ' (' + s.serial + ') • Android ' + (s.androidVersion || '?');
          renderDeviceArch(s);
          setStatus('Loaded ' + state.apps.length + ' packages from ' + s.serial + '.', 'info');
          applyFilter();
          const runId = ++state.metaRunId;
          void loadAppMetadataInBackground(state.serial, runId);
        } catch (err) {
          setStatus(err instanceof Error ? err.message : String(err), 'error');
        } finally {
          state.busy = false;
          renderTable();
          updateStats();
        }
      }

      async function runAction(action, targets) {
        if (!state.serial || targets.length === 0 || state.busy) return;
        const method = methodSelect.value;

        const hasCritical = (action === 'hide' || action === 'uninstall') && targets.some((t) => criticalSet.has(t.name));
        if (action === 'uninstall' || targets.length > 1 || hasCritical) {
          const title = hasCritical
            ? 'Critical system package warning'
            : action === 'uninstall'
              ? 'Confirm uninstall'
              : 'Confirm batch action';
          const body = hasCritical
            ? 'You are about to ' + action + ' a critical system package (' + targets.map((t) => t.name).join(', ') + '). Continue?'
            : action === 'uninstall'
              ? 'Try to uninstall ' + (targets.length === 1 ? (targets[0].label || targets[0].name) + ' (' + targets[0].name + ')' : targets.length + ' selected package(s)') + '? This removes the app and its data (or uninstalls it for user 0 if it is a system app).'
              : (action === 'hide' ? 'Hide ' : 'Unhide ') + targets.length + ' selected package(s) using "' + method + '"?';
          const ok = await askConfirmation(title, body);
          if (!ok) {
            setStatus('Action cancelled.', 'info');
            return;
          }
        }

        state.busy = true;
        renderTable();
        updateStats();
        setStatus((action === 'hide' ? 'Hiding ' : action === 'uninstall' ? 'Uninstalling ' : 'Unhiding ') + targets.length + ' package(s)…', 'info');
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
          if (!res.ok) throw new Error(data.error || 'Action failed');

          const byName = new Map(state.apps.map((a) => [a.name, a]));
          let okCount = 0;
          let failMsg = '';
          let lastOkMsg = '';
          const removedSet = new Set();
          for (const item of data.results) {
            if (item.ok) {
              okCount++;
              lastOkMsg = item.message || '';
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
            setStatus(okCount === 1 && lastOkMsg ? lastOkMsg : action + ' succeeded for ' + okCount + ' package(s).', 'success');
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
          updateStats();
        }
      }

      filterForm.addEventListener('submit', (e) => e.preventDefault());
      searchInput.addEventListener('input', applyFilter);
      filterSelect.addEventListener('change', applyFilter);
      deviceSelect.addEventListener('change', () => {
        state.selected.clear();
        loadDevicesAndPackages(deviceSelect.value);
      });
      refreshBtn.addEventListener('click', () => loadDevicesAndPackages(state.serial));

      selectAllCb.addEventListener('change', () => {
        for (const app of state.filtered) {
          if (selectAllCb.checked) state.selected.add(app.name);
          else state.selected.delete(app.name);
        }
        renderTable();
        updateStats();
      });

      clearSelectedBtn.addEventListener('click', () => {
        state.selected.clear();
        renderTable();
        updateStats();
      });

      hideSelectedBtn.addEventListener('click', () => {
        const targets = state.apps.filter((a) => state.selected.has(a.name) && a.state === 'enabled');
        if (targets.length === 0) {
          setStatus('Selected packages are already hidden/disabled.', 'warn');
          return;
        }
        runAction('hide', targets);
      });

      unhideSelectedBtn.addEventListener('click', () => {
        const targets = state.apps.filter((a) => state.selected.has(a.name) && a.state !== 'enabled');
        if (targets.length === 0) {
          setStatus('Selected packages are already enabled.', 'warn');
          return;
        }
        runAction('unhide', targets);
      });

      uninstallSelectedBtn.addEventListener('click', () => {
        const targets = state.apps.filter((a) => state.selected.has(a.name));
        if (targets.length === 0) return;
        runAction('uninstall', targets);
      });

      connectForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const address = connectInput.value.trim();
        if (!address || state.busy) return;
        state.busy = true;
        updateStats();
        setStatus('Connecting to ' + address + '…', 'info');
        try {
          const res = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Connection failed');
          connectInput.value = '';
          await loadDevicesAndPackages(address);
        } catch (err) {
          setStatus(err instanceof Error ? err.message : String(err), 'error');
        } finally {
          state.busy = false;
          updateStats();
        }
      });

${renderApkDropzoneScript('await loadDevicesAndPackages(state.serial);', 'renderTable(); updateStats();')}

      loadDevicesAndPackages(state.serial);
    })();
  </script>
</body>
</html>`;
}

export const MAX_APK_UPLOAD_BYTES = 1024 * 1024 * 1024;

interface ApkUploadError extends Error {
  statusCode: number;
}

function makeApkUploadError(statusCode: number, message: string): ApkUploadError {
  const err = new Error(message) as ApkUploadError;
  err.statusCode = statusCode;
  return err;
}

/**
 * Stream an uploaded `.apk` payload to a temporary local file and verify its extension and ZIP signature.
 */
export async function saveUploadedApkToTemp(
  req: http.IncomingMessage,
  rawFilename: string,
  maxBytes = MAX_APK_UPLOAD_BYTES,
): Promise<{ tempDir: string; tempPath: string; filename: string; sizeBytes: number }> {
  const baseName = path.basename(rawFilename || '').replace(/[^\w.\- ()+]/g, '_').trim();
  if (!baseName || !baseName.toLowerCase().endsWith('.apk')) {
    throw makeApkUploadError(400, 'Invalid filename: expected an .apk file.');
  }

  const contentLengthHeader = req.headers['content-length'];
  if (contentLengthHeader) {
    const expected = Number.parseInt(Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader, 10);
    if (Number.isFinite(expected) && expected > maxBytes) {
      throw makeApkUploadError(413, `APK file exceeds maximum allowed size (${maxBytes} bytes).`);
    }
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'adbkit-sideload-'));
  const tempPath = path.join(tempDir, 'package.apk');
  const writeStream = fs.createWriteStream(tempPath, { mode: 0o600 });
  let writeError: Error | undefined;
  writeStream.once('error', (err) => {
    writeError = err;
  });

  let totalBytes = 0;
  const headerBytes: number[] = [];

  try {
    for await (const rawChunk of req) {
      if (writeError) throw writeError;
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        throw makeApkUploadError(413, `APK file exceeds maximum allowed size (${maxBytes} bytes).`);
      }
      if (headerBytes.length < 4) {
        for (let i = 0; i < chunk.length && headerBytes.length < 4; i++) {
          headerBytes.push(chunk[i]);
        }
        if (headerBytes.length >= 2 && (headerBytes[0] !== 0x50 || headerBytes[1] !== 0x4b)) {
          throw makeApkUploadError(400, 'Invalid APK file: missing ZIP/APK header (PK).');
        }
      }
      if (!writeStream.write(chunk)) {
        await once(writeStream, 'drain');
      }
    }

    if (writeError) throw writeError;
    if (totalBytes === 0) {
      throw makeApkUploadError(400, 'Uploaded APK file is empty.');
    }
    if (headerBytes.length < 2 || headerBytes[0] !== 0x50 || headerBytes[1] !== 0x4b) {
      throw makeApkUploadError(400, 'Invalid APK file: missing ZIP/APK header (PK).');
    }

    writeStream.end();
    await once(writeStream, 'finish');
    return { tempDir, tempPath, filename: baseName, sizeBytes: totalBytes };
  } catch (err) {
    writeStream.destroy();
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Handle an HTTP APK upload and sideload it to the selected ADB device with console action logging.
 */
export async function handleApkSideloadRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  session: AdbSession,
  defaultSerial = '',
): Promise<void> {
  const serial = url.searchParams.get('serial')?.trim() || defaultSerial;
  const rawFilename = url.searchParams.get('filename') || '';
  if (!serial) {
    sendJson(res, 400, { error: 'Missing serial query parameter' });
    return;
  }

  let tempDir = '';
  const cleanupTemp = async () => {
    if (!tempDir) return;
    const dir = tempDir;
    tempDir = '';
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  };

  let startedAt = 0;
  try {
    const saved = await saveUploadedApkToTemp(req, rawFilename);
    tempDir = saved.tempDir;
    const sizeMb = (saved.sizeBytes / (1024 * 1024)).toFixed(2);
    startedAt = logActionStart(serial, 'sideload', `${saved.filename} (${sizeMb} MB)`);

    await session.runWithClient(async (client) => {
      const device = client.getDevice(serial);
      await device.install(saved.tempPath);
    });

    await cleanupTemp();
    const message = `Sideloaded ${saved.filename} onto ${serial}.`;
    logActionResult(serial, 'sideload', startedAt, true, message);
    sendJson(res, 200, {
      ok: true,
      filename: saved.filename,
      sizeBytes: saved.sizeBytes,
      message,
    });
  } catch (err) {
    await cleanupTemp();
    const msg = err instanceof Error ? err.message : String(err);
    const statusCode = (err && typeof err === 'object' && 'statusCode' in err && typeof (err as { statusCode?: unknown }).statusCode === 'number')
      ? (err as { statusCode: number }).statusCode
      : 500;
    if (startedAt > 0) {
      logActionResult(serial, 'sideload', startedAt, false, msg);
    }
    const code = (err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string')
      ? (err as { code: string }).code
      : undefined;
    sendJson(res, statusCode, code ? { error: msg, code } : { error: msg });
  } finally {
    await cleanupTemp();
  }
}

export function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req: http.IncomingMessage, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error('Request body too large');
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected JSON object body');
  }
  return parsed as Record<string, unknown>;
}

export function isFetchSiteAllowed(req: http.IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (!site) return true;
  const val = Array.isArray(site) ? site[0] : site;
  return val === 'same-origin' || val === 'same-site' || val === 'none';
}

function formatLogTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * Log the start of an action in the console and return its start timestamp.
 */
export function logActionStart(serial: string, action: string, detail?: string): number {
  const suffix = detail ? `: ${detail}` : '';
  console.log(`[${formatLogTime()}] -> [${serial}] Starting ${action}${suffix}`);
  return Date.now();
}

/**
 * Log the completion summary/result of an action in the console.
 */
export function logActionResult(
  serial: string,
  action: string,
  startedAt: number,
  ok: boolean,
  summary: string,
): void {
  const elapsedMs = Date.now() - startedAt;
  const label = ok ? 'Finished' : 'Failed';
  const line = `[${formatLogTime()}] <- [${serial}] ${label} ${action}: ${summary} (${elapsedMs}ms)`;
  if (ok) {
    console.log(line);
  } else {
    console.error(line);
  }
}

/**
 * Execute a batch of hide, unhide, or uninstall actions with console progress and summary logging.
 */
export async function executePackageBatch(
  device: DeviceClient,
  serial: string,
  action: 'hide' | 'unhide' | 'uninstall',
  method: HideMethod,
  targets: ReadonlyArray<{ name: string; state: AppState }>,
): Promise<BatchActionItemResult[]> {
  const pkgPreview = targets.length <= 3
    ? targets.map(t => t.name).join(', ')
    : `${targets.slice(0, 3).map(t => t.name).join(', ')} (+${targets.length - 3} more)`;
  const startedAt = logActionStart(
    serial,
    action,
    `${targets.length} package(s)${action === 'uninstall' ? '' : `, method=${method}`} [${pkgPreview}]`,
  );

  const out: BatchActionItemResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      const resAction = action === 'hide'
        ? await hidePackage(device, target.name, method)
        : action === 'uninstall'
          ? await uninstallPackage(device, target.name)
          : await unhidePackage(device, target.name, target.state, method);
      succeeded++;
      console.log(`  ✓ ${target.name}: ${resAction.message}`);
      out.push({
        name: target.name,
        ok: true,
        state: resAction.state,
        removed: resAction.removed,
        methodUsed: resAction.methodUsed,
        message: resAction.message,
      });
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${target.name}: ${message}`);
      out.push({
        name: target.name,
        ok: false,
        error: message,
      });
    }
  }

  logActionResult(
    serial,
    action,
    startedAt,
    failed === 0,
    `${succeeded} succeeded, ${failed} failed`,
  );
  return out;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Create the HTTP server serving the localhost web GUI and ADB package APIs.
 */
export function createAppHiderServer(session: AdbSession, options: Pick<HideAppsCliOptions, 'serial' | 'filter' | 'method'>): http.Server {
  const metaCache = new Map<string, CachedAppMetadata>();

  const getOrLoadMeta = async (
    device: DeviceClient,
    serial: string,
    pkg: string,
    apkPath?: string,
  ): Promise<CachedAppMetadata> => {
    const cacheKey = `${serial}:${pkg}`;
    const existing = metaCache.get(cacheKey);
    if (existing) return existing;

    const parsed = await extractApkMetadata(device, pkg, apkPath);
    const entry: CachedAppMetadata = {
      label: parsed.label,
      iconData: parsed.icon?.data,
      iconMime: parsed.icon?.mime,
    };
    metaCache.set(cacheKey, entry);
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
        res.end(renderWebPage(nonce, options));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/devices') {
        const devices = await session.runWithClient(async (client) => {
          const list = await client.listDevices();
          const enriched: ListedDeviceInfo[] = await Promise.all(list.map(async (d) => {
            if (d.type !== 'device' && d.type !== 'emulator') {
              return { id: d.id, type: d.type, model: '', androidVersion: '', abi: '' };
            }
            const summary = await fetchDeviceSummary(d.getClient());
            return {
              id: d.id,
              type: d.type,
              model: summary.model,
              androidVersion: summary.androidVersion,
              abi: summary.abi,
            };
          }));
          return enriched;
        });
        const ready = devices.filter(d => d.type === 'device' || d.type === 'emulator');
        sendJson(res, 200, {
          devices,
          defaultSerial: options.serial || ready[0]?.id || '',
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/packages') {
        const serial = url.searchParams.get('serial')?.trim();
        if (!serial) {
          sendJson(res, 400, { error: 'Missing serial query parameter' });
          return;
        }
        const data = await session.runWithClient(async (client) => {
          const device = client.getDevice(serial);
          const [summary, apps] = await Promise.all([
            fetchDeviceSummary(device),
            loadDevicePackages(device),
          ]);
          const enriched = apps.map((app) => {
            const cached = metaCache.get(`${serial}:${app.name}`);
            if (!cached) return app;
            return {
              ...app,
              label: cached.label,
              hasIcon: Boolean(cached.iconData),
            };
          });
          return { summary, apps: enriched };
        });
        sendJson(res, 200, data);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/packages/meta') {
        const body = await readJsonBody(req);
        const serial = typeof body.serial === 'string' ? body.serial.trim() : '';
        const rawPackages = body.packages;
        if (!serial) {
          sendJson(res, 400, { error: 'Missing serial' });
          return;
        }
        if (!Array.isArray(rawPackages) || rawPackages.length === 0 || rawPackages.length > 30) {
          sendJson(res, 400, { error: 'Expected 1 to 30 packages' });
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

        const meta = await session.runWithClient((client) =>
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

      if (req.method === 'POST' && url.pathname === '/api/connect') {
        const body = await readJsonBody(req);
        const address = typeof body.address === 'string' ? body.address.trim() : '';
        if (!address) {
          sendJson(res, 400, { error: 'Missing address' });
          return;
        }
        const startedAt = logActionStart(address, 'connect');
        try {
          const connected = await session.runWithClient(client => client.connect(address));
          logActionResult(address, 'connect', startedAt, true, connected ? 'connected' : 'already connected');
          sendJson(res, 200, { connected, address });
        } catch (err) {
          logActionResult(address, 'connect', startedAt, false, err instanceof Error ? err.message : String(err));
          throw err;
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/packages/install') {
        await handleApkSideloadRequest(req, res, url, session);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/packages/action') {
        const body = await readJsonBody(req);
        const serial = typeof body.serial === 'string' ? body.serial.trim() : '';
        const action = body.action;
        const method = body.method as HideMethod;
        const rawPackages = body.packages;

        if (!serial) {
          sendJson(res, 400, { error: 'Missing serial' });
          return;
        }
        if (action !== 'hide' && action !== 'unhide' && action !== 'uninstall') {
          sendJson(res, 400, { error: 'Invalid action (expected hide, unhide, or uninstall)' });
          return;
        }
        if (!METHODS.includes(method)) {
          sendJson(res, 400, { error: 'Invalid method' });
          return;
        }
        if (!Array.isArray(rawPackages) || rawPackages.length === 0) {
          sendJson(res, 400, { error: 'Missing packages array' });
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
          const pkgState = rec.state;
          if (!RE_PACKAGE_NAME.test(name)) {
            sendJson(res, 400, { error: `Invalid package name: ${name}` });
            return;
          }
          const validState: AppState = pkgState === 'disabled' || pkgState === 'hidden' ? pkgState : 'enabled';
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

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const session = createAdbSession(options);
  if (options.connect) {
    await session.runWithClient(client => client.connect(options.connect as string));
  }

  if (options.listOnly) {
    try {
      const apps = await session.runWithClient(async (client) => {
        let serial = options.serial;
        if (!serial) {
          const devices = await client.listDevices();
          const online = devices.filter(d => d.type === 'device' || d.type === 'emulator');
          if (!online.length) throw new Error('No ready Android device found.');
          serial = online[0].id;
        }
        return loadDevicePackages(client.getDevice(serial));
      });
      for (const app of filterPackages(apps, options.filter, '')) {
        console.log(`${app.state.padEnd(8)} ${app.kind.padEnd(6)} ${app.name}`);
      }
    } finally {
      if (options.backend !== 'native') {
        await YaWebAdbManager.getInstance().killAll();
      }
    }
    return;
  }

  const server = createAppHiderServer(session, options);
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
  console.log(`adbkit App Hider web GUI running at http://localhost:${port}`);
  console.log('Press Ctrl+C to stop.');

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
