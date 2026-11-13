import Net from 'node:net';
import { Buffer } from 'node:buffer';
import Protocol from '../protocol.js';
import Utils from '../utils.js';
import {
  AdbCredentialManagerLike,
  AdbLike,
  AdbModuleLike,
  AdbSocketLike,
  AdbTransportLike,
  ForwardEntry,
  ManagedDeviceInfo,
  UsbInstanceLike,
  UsbRawDeviceLike,
  WebUsbDeviceLike,
  WebUsbDeviceManagerLike,
  WebUsbObserverLike,
  YaWebAdbModules,
  loadYaWebAdb,
  onYaWebAdbReset,
  sanitizeToken,
} from './types.js';
import type { YaWebAdbSocket } from './socket.js';

const debug = Utils.debug('adb:yawebadb');

export class YaWebAdbManager {
  private static instance: YaWebAdbManager | null = null;

  public static getInstance(): YaWebAdbManager {
    if (!YaWebAdbManager.instance) {
      YaWebAdbManager.instance = new YaWebAdbManager();
    }
    return YaWebAdbManager.instance;
  }

  public static resetInstance(): void {
    if (YaWebAdbManager.instance) {
      void YaWebAdbManager.instance.killAll();
      YaWebAdbManager.instance = null;
    }
  }

  private devices = new Map<string, ManagedDeviceInfo>();
  private forwards = new Map<string, ForwardEntry>();
  private trackerListeners = new Set<(devices: ManagedDeviceInfo[]) => void>();
  private activeSockets = new Set<YaWebAdbSocket>();
  private hasReverseTunnels = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTransportId = 1;
  private credentialManager: AdbCredentialManagerLike | null = null;
  private deviceManager: WebUsbDeviceManagerLike | null = null;
  private usbInstance: UsbInstanceLike | null = null;
  private observer: WebUsbObserverLike | null = null;
  private observerDispose: (() => void) | null = null;

  private async getModules(): Promise<YaWebAdbModules> {
    const mods = await loadYaWebAdb();
    if (!mods) {
      throw new Error('ya-webadb optional dependencies are not available');
    }
    return mods;
  }

  private async getCredentialManager(): Promise<AdbCredentialManagerLike> {
    if (!this.credentialManager) {
      const { credentialNodejs } = await this.getModules();
      const storage = new credentialNodejs.TangoNodeJsStorage();
      this.credentialManager = new credentialNodejs.AdbWebCryptoCredentialManager(storage);
    }
    return this.credentialManager;
  }

  private async getDeviceManager(): Promise<WebUsbDeviceManagerLike> {
    if (!this.deviceManager) {
      const { webusb, usb } = await this.getModules();
      this.usbInstance = usb.usb || (usb.WebUSB ? new usb.WebUSB({ allowAllDevices: true }) : usb.default?.usb) || null;
      if (!this.usbInstance) {
        throw new Error('USB instance is not available');
      }
      this.deviceManager = new webusb.AdbDaemonWebUsbDeviceManager(this.usbInstance);
    }
    return this.deviceManager!;
  }

  private wrapUsbDeviceClose(usbDev: WebUsbDeviceLike): void {
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
        if (this.usbInstance && typeof this.usbInstance.dispatchEvent === 'function') {
          const ev = new Event('disconnect');
          Object.defineProperty(ev, 'device', { value: raw });
          this.usbInstance.dispatchEvent(ev);
        }
      } catch {
        // ignore
      }
    };
  }

  private formatUsbPath(usbDev: WebUsbDeviceLike): string {
    const raw = usbDev.raw;
    if (raw && raw.bus !== undefined && raw.address !== undefined) {
      return `usb:${raw.bus}:${raw.address}`;
    }
    return 'usb:0:1';
  }

  private upsertUsbDevice(usbDev: WebUsbDeviceLike): ManagedDeviceInfo {
    this.wrapUsbDeviceClose(usbDev);
    const serial = usbDev.serial || 'unknown';
    let entry = this.devices.get(serial);
    if (!entry) {
      const modelFallback = sanitizeToken(usbDev.name || usbDev.raw?.productName, 'unknown');
      entry = {
        serial,
        state: 'device',
        path: this.formatUsbPath(usbDev),
        product: modelFallback,
        model: modelFallback,
        device: modelFallback,
        transportId: String(this.nextTransportId++),
        isTcp: false,
        detached: false,
        usbDevice: usbDev,
      };
      this.devices.set(serial, entry);
    } else {
      entry.usbDevice = usbDev;
      entry.path = this.formatUsbPath(usbDev);
    }
    return entry;
  }

  /**
   * Attempts to stop a running native ADB server on the given port so it releases exclusive USB locks.
   */
  private async tryKillNativeAdbServer(port = 5037): Promise<boolean> {
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

  private isUsbBusyError(err: unknown): boolean {
    if (!err) return false;
    const str = `${(err as Error).name || ''} ${(err as Error).message || err}`;
    return /busy|claimInterface|exclusive access|LIBUSB_ERROR_BUSY|borrowed mutably|registry id/i.test(str);
  }

  /**
   * Connects and authenticates a USB device, waiting up to `authTimeoutMs` if waiting for user on-screen authorization.
   */
  private async ensureUsbConnected(entry: ManagedDeviceInfo, port = 5037, waitForAuth = true): Promise<AdbLike | null> {
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
        const { adb: adbMod } = await this.getModules();
        const credentialManager = await this.getCredentialManager();
        let usbDev = entry.usbDevice!;

        let connection: unknown;
        try {
          connection = await usbDev.connect();
        } catch (err) {
          if (this.isUsbBusyError(err)) {
            debug('USB interface busy for %s, attempting to stop native ADB server on port %d', entry.serial, port);
            const killed = await this.tryKillNativeAdbServer(port);
            if (killed) {
              for (let attempt = 0; attempt < 5; attempt++) {
                try {
                  const devMgr = await this.getDeviceManager();
                  const freshDevices = await devMgr.getDevices();
                  const freshDev = freshDevices.find((d) => (d.serial || 'unknown') === entry.serial) || usbDev;
                  entry.usbDevice = freshDev;
                  usbDev = freshDev;
                  if (usbDev.raw?.opened) {
                    await usbDev.raw.close().catch(() => { });
                  }
                  connection = await usbDev.connect();
                  break;
                } catch (retryErr) {
                  if (attempt === 4 || !this.isUsbBusyError(retryErr)) {
                    throw retryErr;
                  }
                  await new Promise((r) => setTimeout(r, 150));
                }
              }
            } else {
              throw err;
            }
          } else {
            throw err;
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
            this.notifyTrackers();
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
            this.notifyTrackers();
          }
        });

        this.notifyTrackers();
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

  public async syncDevices(port = 5037, connectUsb = false): Promise<ManagedDeviceInfo[]> {
    const devMgr = await this.getDeviceManager();
    const usbDevices = await devMgr.getDevices();
    const seenUsbSerials = new Set<string>();

    for (const usbDev of usbDevices) {
      const serial = usbDev.serial || 'unknown';
      seenUsbSerials.add(serial);
      const entry = this.upsertUsbDevice(usbDev);
      if (connectUsb && !entry.adb && !entry.detached) {
        await this.ensureUsbConnected(entry, port, false);
      }
    }

    // Remove unplugged USB devices
    for (const [serial, entry] of this.devices.entries()) {
      if (!entry.isTcp && !seenUsbSerials.has(serial)) {
        this.devices.delete(serial);
      }
    }

    return Array.from(this.devices.values());
  }

  public async getDeviceAdb(serial: string, port = 5037): Promise<AdbLike> {
    const entry = await this.getDeviceInfo(serial, port);
    if (entry.detached) {
      throw new Error(`device '${serial}' is detached`);
    }
    if (entry.adb) {
      return entry.adb;
    }
    if (!entry.isTcp) {
      const adb = await this.ensureUsbConnected(entry, port, true);
      if (!adb) {
        throw new Error(`device '${serial}' is ${entry.state}`);
      }
      return adb;
    }
    throw new Error(`device '${serial}' is offline`);
  }

  public async getDeviceInfo(serial: string, port = 5037): Promise<ManagedDeviceInfo> {
    let entry = this.devices.get(serial);
    if (!entry) {
      await this.syncDevices(port);
      entry = this.devices.get(serial);
    }
    if (!entry) {
      throw new Error(`device '${serial}' not found`);
    }
    return entry;
  }

  public async addTracker(listener: (devices: ManagedDeviceInfo[]) => void, port = 5037): Promise<() => void> {
    this.trackerListeners.add(listener);
    if (!this.observer) {
      try {
        const devMgr = await this.getDeviceManager();
        this.observer = await devMgr.trackDevices();
        const onDeviceChange = () => {
          void this.syncDevices(port).then(() => this.notifyTrackers());
        };
        const unsubs = [
          this.observer.onListChange(onDeviceChange),
          this.observer.onDeviceAdd(onDeviceChange),
          this.observer.onDeviceRemove(onDeviceChange),
        ];
        this.observerDispose = () => {
          for (const unsub of unsubs) unsub();
          this.observer?.close();
          this.observer = null;
          this.observerDispose = null;
        };
      } catch (err) {
        debug('USB trackDevices failed: %s', (err as Error)?.message || err);
      }
    }

    return () => {
      this.trackerListeners.delete(listener);
      this.scheduleIdleCheck();
      if (this.trackerListeners.size === 0 && this.observerDispose) {
        this.observerDispose();
      }
    };
  }

  private notifyTrackers(): void {
    if (this.trackerListeners.size === 0) return;
    const list = Array.from(this.devices.values());
    for (const cb of this.trackerListeners) {
      cb(list);
    }
  }

  /**
   * Connects to an ADB over TCP daemon at `host:port` using `@yume-chan/adb`.
   */
  public async connectTcp(host: string, port: number): Promise<'connected' | 'already'> {
    const serial = `${host}:${port}`;
    const existing = this.devices.get(serial);
    if (existing && existing.adb && existing.state === 'device') {
      return 'already';
    }

    const { adb: adbMod } = await this.getModules();
    const credentialManager = await this.getCredentialManager();

    const netSocket = await new Promise<Net.Socket>((resolve, reject) => {
      const s = Net.connect({ host, port });
      s.setNoDelay(true);
      const onError = (err: Error) => {
        s.off('connect', onConnect);
        reject(err);
      };
      const onConnect = () => {
        s.off('error', onError);
        resolve(s);
      };
      s.once('error', onError);
      s.once('connect', onConnect);
    });

    const connection = this.createNetDaemonConnection(netSocket, adbMod);
    const auth = adbMod.adbDaemonAuthenticate || adbMod.AdbDaemonTransport?.authenticate;
    if (!auth) {
      throw new Error('adbDaemonAuthenticate is not available');
    }
    const transport: AdbTransportLike = await auth({
      serial,
      connection,
      credentialManager,
      credentialStore: credentialManager,
    });
    const adbInstance: AdbLike = new adbMod.Adb(transport);

    const entry: ManagedDeviceInfo = {
      serial,
      state: 'device',
      path: `tcp:${host}:${port}`,
      product: sanitizeToken(adbInstance.banner?.product, 'unknown'),
      model: sanitizeToken(adbInstance.banner?.model, 'unknown'),
      device: sanitizeToken(adbInstance.banner?.device, 'unknown'),
      transportId: String(this.nextTransportId++),
      isTcp: true,
      detached: false,
      adb: adbInstance,
      cleanup: async () => {
        netSocket.destroy();
      },
    };

    this.devices.set(serial, entry);

    void adbInstance.disconnected.finally(() => {
      if (this.devices.get(serial)?.adb === adbInstance) {
        this.devices.delete(serial);
        this.notifyTrackers();
      }
    });

    this.notifyTrackers();
    return 'connected';
  }

  private createNetDaemonConnection(netSocket: Net.Socket, adbMod: AdbModuleLike): unknown {
    let buffer = Buffer.alloc(0);
    let closed = false;
    let pendingRead: (() => void) | null = null;

    netSocket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (pendingRead) {
        const resolve = pendingRead;
        pendingRead = null;
        resolve();
      }
    });

    const onEndOrError = () => {
      closed = true;
      if (pendingRead) {
        const resolve = pendingRead;
        pendingRead = null;
        resolve();
      }
    };
    netSocket.on('end', onEndOrError);
    netSocket.on('close', onEndOrError);
    netSocket.on('error', onEndOrError);

    const readBytes = async (n: number): Promise<Uint8Array | null> => {
      while (buffer.length < n) {
        if (closed) return null;
        await new Promise<void>((resolve) => {
          pendingRead = resolve;
        });
      }
      const out = new Uint8Array(buffer.buffer, buffer.byteOffset, n);
      buffer = buffer.subarray(n);
      return out;
    };

    const readable = new globalThis.ReadableStream({
      pull: async (controller) => {
        const headerBytes = await readBytes(24);
        if (!headerBytes) {
          controller.close();
          return;
        }
        const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, 24);
        const command = view.getUint32(0, true);
        const arg0 = view.getUint32(4, true);
        const arg1 = view.getUint32(8, true);
        const payloadLength = view.getUint32(12, true);
        const checksum = view.getUint32(16, true);
        const magic = view.getUint32(20, true);

        let payload: Uint8Array = new Uint8Array(0);
        if (payloadLength > 0) {
          const payloadBytes = await readBytes(payloadLength);
          if (!payloadBytes) {
            controller.close();
            return;
          }
          payload = payloadBytes;
        }
        controller.enqueue({ command, arg0, arg1, payloadLength, checksum, magic, payload });
      },
      cancel: () => {
        netSocket.destroy();
      },
    });

    const serializeStream = new adbMod.AdbPacketSerializeStream();
    const reader = serializeStream.readable.getReader();
    void (async () => {
      try {
        for (; ;) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          const chunk: Uint8Array = 'value' in value ? value.value : value;
          await new Promise<void>((resolve, reject) => {
            netSocket.write(chunk, (err) => (err ? reject(err) : resolve()));
          });
        }
      } catch {
        // socket closed
      }
    })();

    return {
      readable,
      writable: serializeStream.writable,
    };
  }

  private async closeDeviceAdb(entry: ManagedDeviceInfo): Promise<void> {
    const adb = entry.adb;
    entry.adb = undefined;
    entry.connectingPromise = undefined;
    try {
      await adb?.close();
      await entry.cleanup?.();
    } catch {
      // ignore
    }
  }

  public async disconnectTcp(host: string, port: number): Promise<boolean> {
    const serial = `${host}:${port}`;
    const entry = this.devices.get(serial);
    if (!entry) {
      return false;
    }
    this.devices.delete(serial);
    await this.closeDeviceAdb(entry);
    this.notifyTrackers();
    return true;
  }

  public async attachDevice(serial: string, port = 5037): Promise<void> {
    const entry = await this.getDeviceInfo(serial, port);
    entry.detached = false;
    await this.ensureUsbConnected(entry, port, true);
  }

  public async detachDevice(serial: string, port = 5037): Promise<void> {
    const entry = await this.getDeviceInfo(serial, port);
    entry.detached = true;
    entry.state = 'offline';
    await this.closeDeviceAdb(entry);
    this.notifyTrackers();
  }

  public async addForward(serial: string, local: string, remote: string, adbPort = 5037): Promise<void> {
    // Ensure the device exists
    await this.getDeviceInfo(serial, adbPort);

    const key = `${serial}:${local}`;
    const existing = this.forwards.get(key);
    if (existing) {
      existing.remote = remote;
      return;
    }

    if (!local.startsWith('tcp:')) {
      throw new Error(`Unsupported local forward specification: ${local}`);
    }
    const localPort = parseInt(local.slice(4), 10);
    if (isNaN(localPort)) {
      throw new Error(`Invalid local TCP port in forward: ${local}`);
    }

    const server = Net.createServer((clientSocket) => {
      void (async () => {
        try {
          const adb = await this.getDeviceAdb(serial, adbPort);
          const adbSocket = await adb.createSocket(remote);
          bridgeNetAndAdbSocket(clientSocket, adbSocket);
        } catch (err) {
          debug('Forward connection error (%s -> %s): %s', local, remote, (err as Error)?.message || err);
          clientSocket.destroy();
        }
      })();
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(localPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : localPort;
    const normalizedLocal = `tcp:${boundPort}`;
    this.forwards.set(`${serial}:${normalizedLocal}`, {
      serial,
      local: normalizedLocal,
      remote,
      server,
    });
  }

  public async killForward(serial: string, local: string): Promise<void> {
    const key = `${serial}:${local}`;
    const entry = this.forwards.get(key);
    if (!entry) {
      throw new Error(`listener '${local}' not found`);
    }
    this.forwards.delete(key);
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }

  public listForwards(serial?: string): Array<{ serial: string; local: string; remote: string }> {
    const result: Array<{ serial: string; local: string; remote: string }> = [];
    for (const entry of this.forwards.values()) {
      if (!serial || entry.serial === serial) {
        result.push({ serial: entry.serial, local: entry.local, remote: entry.remote });
      }
    }
    return result;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private isBusy(): boolean {
    return (
      this.activeSockets.size > 0 ||
      this.forwards.size > 0 ||
      this.trackerListeners.size > 0 ||
      this.hasReverseTunnels
    );
  }

  public registerSocket(socket: YaWebAdbSocket): void {
    this.activeSockets.add(socket);
    this.clearIdleTimer();
  }

  public unregisterSocket(socket: YaWebAdbSocket): void {
    this.activeSockets.delete(socket);
    this.scheduleIdleCheck();
  }

  public markReverseTunnelAdded(): void {
    this.hasReverseTunnels = true;
    this.clearIdleTimer();
  }

  private scheduleIdleCheck(): void {
    this.clearIdleTimer();
    if (!this.isBusy()) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        void this.closeIdleUsbDevices();
      }, 100);
      this.idleTimer.unref?.();
    }
  }

  private async closeIdleUsbDevices(): Promise<void> {
    if (this.isBusy()) {
      return;
    }
    for (const entry of this.devices.values()) {
      if (!entry.isTcp && entry.adb) {
        await this.closeDeviceAdb(entry);
      }
    }
  }

  public async killAll(): Promise<void> {
    this.clearIdleTimer();
    this.hasReverseTunnels = false;
    if (this.observerDispose) {
      this.observerDispose();
    }
    for (const fwd of this.forwards.values()) {
      fwd.server.close();
    }
    this.forwards.clear();
    for (const entry of this.devices.values()) {
      await this.closeDeviceAdb(entry);
    }
    this.devices.clear();
  }
}

// Wire reset listener so setYaWebAdbLoader resets the manager instance
onYaWebAdbReset(() => {
  YaWebAdbManager.resetInstance();
});

export function bridgeNetAndAdbSocket(netSocket: Net.Socket, adbSocket: AdbSocketLike): void {
  const writer = adbSocket.writable.getWriter();
  const reader = adbSocket.readable.getReader();

  netSocket.on('data', (chunk: Buffer) => {
    const uint8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    writer.write(uint8).catch(() => {
      netSocket.destroy();
    });
  });

  const closeAdb = () => void Promise.resolve(adbSocket.close()).catch(() => {});
  netSocket.on('end', () => {
    closeAdb();
    if (!netSocket.destroyed) {
      netSocket.end();
    }
  });

  netSocket.on('error', closeAdb);

  void (async () => {
    try {
      for (; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && !netSocket.destroyed) {
          netSocket.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        }
      }
    } catch {
      // ignore
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      if (!netSocket.destroyed) {
        netSocket.end();
      }
    }
  })();
}

