import Utils from '../utils.js';
import { DeviceType } from '../../models/Device.js';
import Net from 'node:net';

const debug = Utils.debug('adb:yawebadb:loader');

// Minimal internal structural types for @yume-chan/* and usb to avoid leaking optional dependency types into public .d.ts
export interface AdbBannerLike {
  product?: string;
  model?: string;
  device?: string;
  features: readonly string[];
}

export interface AdbSocketLike {
  readonly service: string;
  readonly closed: Promise<undefined>;
  readonly readable: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      releaseLock(): void;
      cancel(reason?: unknown): Promise<void>;
    };
  };
  readonly writable: {
    getWriter(): {
      write(chunk: Uint8Array): Promise<void>;
      close(): Promise<void>;
      abort(reason?: unknown): Promise<void>;
      releaseLock(): void;
    };
  };
  close(): Promise<void> | void;
}

export interface AdbTransportLike {
  readonly serial: string;
  readonly maxPayloadSize: number;
  readonly banner: AdbBannerLike;
  readonly disconnected: Promise<void>;
  readonly clientFeatures: readonly string[];
  connect(service: string): Promise<AdbSocketLike> | AdbSocketLike;
  addReverseTunnel(handler: (socket: AdbSocketLike) => Promise<void> | void, address?: string): Promise<string> | string;
  removeReverseTunnel(address: string): Promise<void> | void;
  clearReverseTunnels(): Promise<void> | void;
  close(): Promise<void> | void;
}

export interface AdbLike {
  readonly transport: AdbTransportLike;
  readonly serial: string;
  readonly banner: AdbBannerLike;
  readonly disconnected: Promise<void>;
  createSocket(service: string): Promise<AdbSocketLike>;
  close(): Promise<void>;
}

export interface UsbRawDeviceLike {
  bus?: string | number;
  address?: number;
  ports?: number[];
  productName?: string | null;
  manufacturerName?: string | null;
  serialNumber?: string | null;
  opened?: boolean;
  close(): Promise<void>;
}

export interface WebUsbDeviceLike {
  readonly raw: UsbRawDeviceLike;
  readonly serial: string;
  readonly name: string;
  connect(): Promise<unknown>;
}

export interface WebUsbObserverLike {
  readonly current: readonly WebUsbDeviceLike[];
  onDeviceAdd: (listener: (devices: readonly WebUsbDeviceLike[]) => void) => () => void;
  onDeviceRemove: (listener: (devices: readonly WebUsbDeviceLike[]) => void) => () => void;
  onListChange: (listener: (devices: readonly WebUsbDeviceLike[]) => void) => () => void;
  close(): void;
}

export interface WebUsbDeviceManagerLike {
  getDevices(): Promise<WebUsbDeviceLike[]>;
  trackDevices(): Promise<WebUsbObserverLike>;
}

export interface YaWebAdbModules {
  adb: Record<string, any>;
  webusb: Record<string, any>;
  credentialNodejs: Record<string, any>;
  usb: Record<string, any>;
}

export interface ManagedDeviceInfo {
  serial: string;
  state: DeviceType;
  path: string;
  product: string;
  model: string;
  device: string;
  transportId: string;
  isTcp: boolean;
  detached: boolean;
  usbDevice?: WebUsbDeviceLike;
  adb?: AdbLike;
  connectingPromise?: Promise<AdbLike>;
  cleanup?: () => Promise<void>;
}

export interface ForwardEntry {
  serial: string;
  local: string;
  remote: string;
  server: Net.Server;
}

export function sanitizeToken(val: string | undefined | null, fallback = 'unknown'): string {
  if (!val) return fallback;
  const cleaned = val.trim().replace(/\s+/g, '_');
  return cleaned || fallback;
}

let cachedModulesPromise: Promise<YaWebAdbModules | null> | null = null;
let overrideLoader: (() => Promise<YaWebAdbModules | null>) | null = null;
const resetListeners = new Set<() => void>();

/**
 * Register a callback when yawebadb is reset (e.g. by setYaWebAdbLoader).
 */
export function onYaWebAdbReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
}

/**
 * Override the module loader (primarily for unit tests).
 */
export function setYaWebAdbLoader(loader: (() => Promise<YaWebAdbModules | null>) | null): void {
  overrideLoader = loader;
  cachedModulesPromise = null;
  for (const listener of resetListeners) {
    listener();
  }
}

/**
 * Dynamically loads `@yume-chan/adb`, `@yume-chan/adb-daemon-webusb`,
 * `@yume-chan/adb-credential-nodejs`, and `usb` if installed.
 */
export async function loadYaWebAdb(): Promise<YaWebAdbModules | null> {
  if (overrideLoader) {
    return overrideLoader();
  }
  if (!cachedModulesPromise) {
    cachedModulesPromise = (async () => {
      try {
        const [adb, webusb, credentialNodejs, usb] = await Promise.all([
          import('@yume-chan/adb'),
          import('@yume-chan/adb-daemon-webusb'),
          import('@yume-chan/adb-credential-nodejs'),
          import('usb'),
        ]);
        debug('ya-webadb optional dependencies loaded successfully');
        return { adb, webusb, credentialNodejs, usb };
      } catch (err) {
        debug('ya-webadb optional dependencies are not available: %s', (err as Error)?.message || err);
        return null;
      }
    })();
  }
  return cachedModulesPromise;
}

/**
 * Checks if `ya-webadb` (`@yume-chan/adb` + `@yume-chan/adb-daemon-webusb` + `@yume-chan/adb-credential-nodejs` + `usb`) is available.
 */
export async function isYaWebAdbAvailable(): Promise<boolean> {
  const mods = await loadYaWebAdb();
  return mods !== null;
}

