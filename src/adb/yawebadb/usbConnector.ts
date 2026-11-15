import Net from 'node:net';
import Protocol from '../protocol.js';
import Utils from '../utils.js';
import {
  AdbCredentialManagerLike,
  AdbLike,
  AdbTransportLike,
  ManagedDeviceInfo,
  UsbInstanceLike,
  UsbRawDeviceLike,
  WebUsbDeviceLike,
  WebUsbDeviceManagerLike,
  YaWebAdbModules,
  sanitizeToken,
} from './types.js';

const debug = Utils.debug('adb:yawebadb');

/**
 * Wrap `raw.close()` on a WebUSB device so disconnect events are dispatched cleanly.
 */
export function wrapUsbDeviceClose(usbDev: WebUsbDeviceLike, usbInstance: UsbInstanceLike | null): void {
  const raw = usbDev.raw as UsbRawDeviceLike & { _yaWrapped?: boolean };
  if (!raw || raw._yaWrapped || typeof raw.close !== 'function') {
    return;
  }
  raw._yaWrapped = true;
  const origClose = raw.close.bind(raw);
  raw.close = async () => {
    try {
      await origClose();
    } catch {
      // ignore close errors
    }
    try {
      if (usbInstance && typeof usbInstance.dispatchEvent === 'function') {
        const ev = new Event('disconnect');
        Object.defineProperty(ev, 'device', { value: raw });
        usbInstance.dispatchEvent(ev);
      }
    } catch {
      // ignore
    }
  };
}

/**
 * Format a `usb:<bus>:<address>` device path string for `host:devices-l`.
 */
export function formatUsbPath(usbDev: WebUsbDeviceLike): string {
  const raw = usbDev.raw;
  if (raw && raw.bus !== undefined && raw.address !== undefined) {
    return `usb:${raw.bus}:${raw.address}`;
  }
  return 'usb:0:1';
}

/**
 * Attempts to stop a running native ADB server on the given port so it releases exclusive USB locks.
 */
export async function tryKillNativeAdbServer(port = 5037): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const sock = Net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      if (ok) {
        setTimeout(() => resolve(true), 150);
      } else {
        resolve(false);
      }
    };
    const timer = setTimeout(() => finish(false), 1000);
    sock.once('error', () => finish(false));
    sock.once('connect', () => {
      sock.write(Protocol.encodeData('host:kill'));
    });
    sock.once('data', () => {
      finish(true);
    });
    sock.once('close', () => {
      finish(true);
    });
  });
}

export function isUsbBusyError(err: unknown): boolean {
  if (!err) return false;
  const str = `${(err as Error).name || ''} ${(err as Error).message || err}`;
  return /busy|claimInterface|exclusive access|LIBUSB_ERROR_BUSY|borrowed mutably|registry id/i.test(str);
}

export interface UsbConnectContext {
  entry: ManagedDeviceInfo;
  port: number;
  waitForAuth: boolean;
  getModules: () => Promise<YaWebAdbModules>;
  getCredentialManager: () => Promise<AdbCredentialManagerLike>;
  getDeviceManager: () => Promise<WebUsbDeviceManagerLike>;
  onStateChange: () => void;
}

/**
 * Connects and authenticates a USB device, waiting up to 1500ms if `waitForAuth` is false.
 */
export async function ensureUsbDeviceConnected(ctx: UsbConnectContext): Promise<AdbLike | null> {
  const { entry, port, waitForAuth } = ctx;
  if (entry.detached) {
    entry.state = 'offline';
    return null;
  }
  if (entry.adb) {
    return entry.adb;
  }
  if (!entry.usbDevice) {
    return null;
  }

  let onAuthPrompt: (() => void) | undefined;
  const authPromptPromise = new Promise<null>((resolve) => {
    onAuthPrompt = () => resolve(null);
  });

  if (!entry.connectingPromise) {
    entry.connectingPromise = (async () => {
      const { adb: adbMod } = await ctx.getModules();
      const credentialManager = await ctx.getCredentialManager();
      let usbDev = entry.usbDevice!;

      let connection: unknown;
      try {
        connection = await usbDev.connect();
      } catch (err) {
        if (!isUsbBusyError(err)) {
          throw err;
        }
        debug('USB interface busy for %s, attempting to stop native ADB server on port %d', entry.serial, port);
        const killed = await tryKillNativeAdbServer(port);
        if (!killed) {
          throw err;
        }
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const devMgr = await ctx.getDeviceManager();
            const freshDevices = await devMgr.getDevices();
            const freshDev = freshDevices.find((d) => (d.serial || 'unknown') === entry.serial) || usbDev;
            entry.usbDevice = freshDev;
            usbDev = freshDev;
            if (usbDev.raw?.opened) {
              await usbDev.raw.close().catch(() => {});
            }
            connection = await usbDev.connect();
            break;
          } catch (retryErr) {
            if (attempt === 4 || !isUsbBusyError(retryErr)) {
              throw retryErr;
            }
            await new Promise((r) => setTimeout(r, 150));
          }
        }
      }

      const auth = adbMod.adbDaemonAuthenticate || adbMod.AdbDaemonTransport?.authenticate;
      if (!auth) {
        throw new Error('adbDaemonAuthenticate is not available');
      }
      const transport: AdbTransportLike = await auth({
        serial: entry.serial,
        connection,
        credentialManager,
        credentialStore: credentialManager,
        onPublicKeyAuthentication: () => {
          debug('Device %s requires on-device public key authorization', entry.serial);
          entry.state = 'unauthorized';
          onAuthPrompt?.();
          ctx.onStateChange();
        },
      });

      const adbInstance: AdbLike = new adbMod.Adb(transport);
      entry.adb = adbInstance;
      entry.state = 'device';
      if (adbInstance.banner) {
        entry.product = sanitizeToken(adbInstance.banner.product, entry.product);
        entry.model = sanitizeToken(adbInstance.banner.model, entry.model);
        entry.device = sanitizeToken(adbInstance.banner.device, entry.device);
      }

      void adbInstance.disconnected.finally(() => {
        if (entry.adb === adbInstance) {
          entry.adb = undefined;
          entry.connectingPromise = undefined;
          entry.state = 'offline';
          ctx.onStateChange();
        }
      });

      ctx.onStateChange();
      return adbInstance;
    })().catch((err) => {
      entry.connectingPromise = undefined;
      if (entry.state !== 'unauthorized') {
        entry.state = 'offline';
      }
      throw err;
    });
  }

  if (!waitForAuth) {
    try {
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
      return await Promise.race([entry.connectingPromise, authPromptPromise, timeoutPromise]);
    } catch (err) {
      debug('Failed connecting to USB device %s: %s', entry.serial, (err as Error)?.message || err);
      return null;
    }
  }

  return entry.connectingPromise;
}
