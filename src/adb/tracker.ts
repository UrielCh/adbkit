import { AdbPrematureEOFError } from './errors.js';
import EventEmitter from 'node:events';
import Device from '../models/Device.js';
import HostDevicesCommand from './command/host/HostDevicesCommand.js';
import HostDevicesWithPathsCommand from './command/host/HostDevicesWithPathsCommand.js';
import TrackerChangeSet from '../models/TrackerChangeSet.js';
import { HostTrackDevicesCommand } from './command/host/index.js';

/**
 * enforce EventEmitter typing
 */
interface IEmissions {
  /**
   * Emitted when the underlying connection ends.
   */
  end: () => void
  /**
   * **(device)** Emitted when a new device is connected, once per device. See `client.listDevices()` for details on the device object.
   */
  add: (device: Device) => void
  /**
   * **(device)** Emitted when a device is unplugged, once per device. This does not include `offline` devices, those devices are connected but unavailable to ADB. See `client.listDevices()` for details on the device object.
   */
  remove: (device: Device) => void

  offline: (device: Device) => void
  online: (device: Device) => void

  /**
   * **(device)** Emitted when the `type` property of a device changes, once per device. The current value of `type` is the new value. This event usually occurs the type changes from `'device'` to `'offline'` or the other way around. See `client.listDevices()` for details on the device object and the `'offline'` type.
   */
  change: (newDevice: Device, oldDevice: Device) => void
  /**
   * **(changes)** Emitted once for all changes reported by ADB in a single run. Multiple changes can occur when, for example, a USB hub is connected/unplugged and the device list changes quickly. If you wish to process all changes at once, use this event instead of the once-per-device ones. Keep in mind that the other events will still be emitted, though.
   */
  changeSet: (changeSet: TrackerChangeSet) => void
  /**
   * **(err)** Emitted if there's an error.
   */
  error: (data: Error) => void
}

/**
 * emit event on Device status chage
 */
export default class Tracker extends EventEmitter {
  private deviceMap = new Map<string, Device>();
  private stoped = false;

  constructor(private readonly command: HostDevicesCommand | HostDevicesWithPathsCommand | HostTrackDevicesCommand) {
    super();
    this.readloop();
  }

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => {
    // never miss past events
    if (event === 'add') {
      for (const device of this.deviceMap.values())
        (listener as ((device: Device) => void))(device);
    } else if (event === 'online') {
      for (const device of this.deviceMap.values())
        if (device.type !== 'offline')
          (listener as ((device: Device) => void))(device);
    } else if (event === 'offline') {
      for (const device of this.deviceMap.values())
        if (device.type === 'offline')
          (listener as ((device: Device) => void))(device);
    }
    super.on(event, listener);
    return this;
  }
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  private async readloop(): Promise<void> {
    try {
      for (; ;) {
        const list = await this.command._readDevices();
        this.update(list);
      }
    } catch (err) {
      if (!this.stoped) {
        this.emit('error', err as Error)
        if (err instanceof AdbPrematureEOFError) {
          throw new Error('Connection closed');
        }
      }
    } finally {
      this.command.parser.end().catch(() => {/* drop error */ });
      this.emit('end');
    }
  }
  /**
   * should be private but need public for testing
   * @param newList updated Device list
   * @returns this
   */
  public update(newList: Device[]): this {
    let changeSet: TrackerChangeSet | undefined;
    if (this.listenerCount('changeSet')) changeSet = { removed: [], changed: [], added: [] };

    const newMap = new Map<string, Device>();
    for (const device of newList) {
      newMap.set(device.id, device);
      const oldDevice = this.deviceMap.get(device.id);
      if (oldDevice) {
        this.deviceMap.delete(device.id);
        if (oldDevice.type !== device.type) {
          if (changeSet) changeSet.changed.push(device);
          this.emit('change', device, oldDevice);
          if (device.type === 'offline')
            this.emit('offline', device);
          else
            this.emit('online', device);
        }
      } else {
        if (changeSet) changeSet.added.push(device);
        this.emit('add', device);
        if (device.type === 'offline') {
          this.emit('offline', device);
        } else {
          this.emit('online', device);
        }
      }
    }
    for (const device of this.deviceMap.values()) {
      if (changeSet) changeSet.removed.push(device);
      this.emit('remove', device);
      if (device.type !== 'offline')
        this.emit('offline', device);
    }
    if (changeSet) this.emit('changeSet', changeSet);
    this.deviceMap = newMap;
    return this;
  }

  public end(): void {
    this.stoped = true;
    this.command.parser.end().catch(() => {/* drop error */ });
  }
}
