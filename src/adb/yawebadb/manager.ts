import Utils from '../utils.js';
import {
  AdbCredentialManagerLike,
  AdbLike,
  ManagedDeviceInfo,
  UsbInstanceLike,
  WebUsbDeviceLike,
  WebUsbDeviceManagerLike,
  WebUsbObserverLike,
  YaWebAdbModules,
  loadYaWebAdb,
  onYaWebAdbReset,
  sanitizeToken,
} from './types.js';
import type { YaWebAdbSocket } from './socket.js';
import { bridgeNetAndAdbSocket, connectTcpDevice } from './tcpBridge.js';
import { ensureUsbDeviceConnected, formatUsbPath, wrapUsbDeviceClose } from './usbConnector.js';
import { YaWebAdbForwardManager } from './forwardManager.js';

export { bridgeNetAndAdbSocket };

const debug = Utils.debug('adb:yawebadb');

/**
 * Coordinates `ya-webadb` device discovery, authentication, port forwarding, and idle lifecycle.
 */
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
  private forwardManager = new YaWebAdbForwardManager();
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

  private upsertUsbDevice(usbDev: WebUsbDeviceLike): ManagedDeviceInfo {
    wrapUsbDeviceClose(usbDev, this.usbInstance);
    const serial = usbDev.serial || 'unknown';
    let entry = this.devices.get(serial);
    if (!entry) {
      const modelFallback = sanitizeToken(usbDev.name || usbDev.raw?.productName, 'unknown');
      entry = {
        serial,
        state: 'device',
        path: formatUsbPath(usbDev),
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
      entry.path = formatUsbPath(usbDev);
    }
    return entry;
  }

  private ensureUsbConnected(entry: ManagedDeviceInfo, port = 5037, waitForAuth = true): Promise<AdbLike | null> {
    return ensureUsbDeviceConnected({
      entry,
      port,
      waitForAuth,
      getModules: () => this.getModules(),
      getCredentialManager: () => this.getCredentialManager(),
      getDeviceManager: () => this.getDeviceManager(),
      onStateChange: () => this.notifyTrackers(),
    });
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

    const entry = await connectTcpDevice({
      host,
      port,
      adbMod,
      credentialManager,
      transportId: String(this.nextTransportId++),
      onDisconnected: (adbInstance) => {
        if (this.devices.get(serial)?.adb === adbInstance) {
          this.devices.delete(serial);
          this.notifyTrackers();
        }
      },
    });

    this.devices.set(serial, entry);
    this.notifyTrackers();
    return 'connected';
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
    await this.getDeviceInfo(serial, adbPort);
    await this.forwardManager.addForward(serial, local, remote, () => this.getDeviceAdb(serial, adbPort));
  }

  public async killForward(serial: string, local: string): Promise<void> {
    await this.forwardManager.killForward(serial, local);
  }

  public listForwards(serial?: string): Array<{ serial: string; local: string; remote: string }> {
    return this.forwardManager.listForwards(serial);
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
      this.forwardManager.size > 0 ||
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
    this.forwardManager.closeAll();
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
