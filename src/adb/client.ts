import EventEmitter from 'node:events';
import Connection from './connection.js';

import {
  HostVersionCommand,
  HostConnectCommand,
  HostDevicesCommand,
  HostDevicesWithPathsCommand,
  HostDisconnectCommand,
  HostTrackDevicesCommand,
  HostKillCommand,
} from './command/host/index.js';
import TcpUsbServer from './tcpusb/server.js';
import Device from '../models/Device.js';
import { ClientOptions } from '../models/ClientOptions.js';
import SocketOptions from '../models/SocketOptions.js';
import Tracker from './tracker.js';
import DeviceWithPath from '../models/DeviceWithPath.js';
import DeviceClient from './DeviceClient.js';

/**
 * enforce EventEmitter typing
 */
interface IEmissions {
  error: (data: Error) => void
}

export default class Client extends EventEmitter {
  //   public readonly options: ClientOptions & { host: string, bin: string };
  public readonly options: ClientOptions & Required<Pick<ClientOptions, 'host' | 'bin'>>;

  /**
 * host to connect default is 127.0.0.1
 */

  public get host(): string {
    return this.options.host;
  }
  /**
   * The port where the ADB server is listening. Defaults to `5037`.
   */
  public get port(): number | string {
    return this.options.port
  }
  /**
   * As the sole exception, this option provides the path to the `adb` binary, used for starting the server locally if initial connection fails. Defaults to `'adb'`.
   */
  public get bin(): string {
    return this.options.bin
  }

  constructor({ host = '127.0.0.1', port = 5037, bin = 'adb' }: ClientOptions = { port: 5037 }) {
    super();
    this.options = { host, port, bin };
  }

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  public createTcpUsbBridge(serial: string, options: SocketOptions): TcpUsbServer {
    return new TcpUsbServer(this, serial, options);
  }

  public connection(): Promise<Connection> {
    const connection = new Connection(this);
    // Reemit unhandled connection errors, so they can be handled externally.
    // If not handled at all, these will crash node.
    connection.on('error', (err) => this.emit('error', err));
    return connection.connect();
  }

  /**
   * Queries the ADB server for its version. This is mainly useful for backwards-compatibility purposes.
   * 
   * @returns The version of the ADB server.
   */
  public async version(): Promise<number> {
    const conn = await this.connection();
    return new HostVersionCommand(conn).execute();
  }

  /**
   * Connects to the given device, which must have its ADB daemon running in tcp mode (see `client.tcpip()`) and be accessible on the same network. Same as `adb connect <host>:<port>`.
   * @param host The target host. Can also contain the port, in which case the port argument is not used and can be skipped.
   * @param port Optional. The target port. Defaults to `5555`
   * @returns true is a new connetion is etablish, or false if already connected.
   * @example
   * switch to TCP mode and set up a forward for Chrome devtools
   * ```ts
   * import Adb from '@u4/adbkit';
   * const client = Adb.createClient();
   * // Note: be careful with using `client.listDevices()` together with `client.tcpip()`
   * // and other similar methods that modify the connection with ADB. You might have the
   * // same device twice in your device list (i.e. one device connected via both USB and
   * // TCP), which can cause havoc if run simultaneously.
   * 
   * const test = async () => {
   *     try {
   *         const devices = await client.listDevices();
   *         for (const device of devices) {
   *             const device = client.getDevice(device.id);
   *             const port = await device.tcpip();
   *             // Switching to TCP mode causes ADB to lose the device for a
   *             // moment, so let's just wait till we get it back.
   *             await device.waitForDevice();
   *             const ip = await device.getDHCPIpAddress();
   *             const deviceTCP = await client.connect(ip, port);
   *             // It can take a moment for the connection to happen.
   *             await deviceTCP.waitForDevice();
   *             await deviceTCP.forward('tcp:9222', 'localabstract:chrome_devtools_remote');
   *             console.log(`Setup devtools on "${id}"`);
   *         };
   *     } catch (err) {
   *         console.error('Something went wrong:', err.stack);
   *     }
   * };
   * ```
   */
  public async connect(host: string, port = 5555): Promise<boolean> {
    if (host.indexOf(':') !== -1) {
      const [h, portString] = host.split(':', 2);
      host = h;
      const parsed = parseInt(portString, 10);
      if (!isNaN(parsed)) {
        port = parsed;
      }
    }
    const conn = await this.connection();
    return new HostConnectCommand(conn).execute(host, port);
  }

  /**
   * Disconnects from the given device, which should have been connected via `client.connect()` or just `adb connect <host>:<port>`.
   * @param host The target host. Can also contain the port, in which case the port argument is not used and can be skipped. In other words you can just put the `id` you got from `client.connect()` here and it will be fine.
   * @param port Optional. The target port. Defaults to `5555`.
   * @returns The disconnected device ID. Will no longer be usable as a `serial` in other commands until you've connected again.
   */
  public async disconnect(host: string, port = 5555): Promise<DeviceClient> {
    if (host.indexOf(':') !== -1) {
      const [h, portString] = host.split(':', 2);
      host = h;
      const parsed = parseInt(portString, 10);
      if (!isNaN(parsed)) {
        port = parsed;
      }
    }
    const conn = await this.connection();
    const deviceId = await new HostDisconnectCommand(conn).execute(host, port);
    return new DeviceClient(this, deviceId);
  }

  /**
   * Gets the list of currently connected devices and emulators.
   * @returns An array of device objects. The device objects are plain JavaScript objects with two properties: `id` and `type`.
   */
  public async listDevices(): Promise<Device[]> {
    const conn = await this.connection();
    return new HostDevicesCommand(conn).execute();
  }

  /**
   * Like `client.listDevices()`, but includes the "path" of every device.
   * @returns An array of device objects.
   */
  public async listDevicesWithPaths(): Promise<DeviceWithPath[]> {
    const conn = await this.connection();
    return new HostDevicesWithPathsCommand(conn).execute();
  }

  /**
   * Gets a device tracker. Events will be emitted when devices are added, removed, or their type changes (i.e. to/from `offline`). Note that the same events will be emitted for the initially connected devices also, so that you don't need to use both `client.listDevices()` and `client.trackDevices()`.
   * 
   * Note that as the tracker will keep a connection open, you must call `tracker.end()` if you wish to stop tracking devices.
   * @example
   * Tracking devices
   * ```ts
   * import Adb from '@u4/adbkit';
   * 
   * const client = Adb.createClient();
   * const test = async () => {
   *     try {
   *         const tracker = await client.trackDevices();
   *         tracker.on('add', (device) => console.log('Device %s was plugged in', device.id));
   *         tracker.on('remove', (device) => console.log('Device %s was unplugged', device.id));
   *         tracker.on('end', () => console.log('Tracking stopped'));
   *     } catch (err) {
   *         console.error('Something went wrong:', err.stack);
   *     }
   * };
   * ```
   * @example
   * Tracking devices avoiding offline devices
   * ```ts
   * import Adb from '@u4/adbkit';
   * 
   * const client = Adb.createClient();
   * const test = async () => {
   *     try {
   *         const tracker = await client.trackDevices();
   *         tracker.on('online', (device) => console.log('Device %s is online', device.id));
   *         tracker.on('offline', (device) => console.log('Device %s is offline', device.id));
   *         tracker.on('end', () => console.log('Tracking stopped'));
   *     } catch (err) {
   *         console.error('Something went wrong:', err.stack);
   *     }
   * };
   * ```
   */
  public async trackDevices(): Promise<Tracker> {
    const conn = await this.connection();
    return new HostTrackDevicesCommand(conn).execute();
  }

  /**
   * This kills the ADB server. Note that the next connection will attempt to start the server again when it's unable to connect
   * @returns true
   */
  public async kill(): Promise<boolean> {
    const conn = await this.connection();
    return new HostKillCommand(conn).execute();
  }

  /**
   * Get as DeviceClient attached to a device
   * @param serial device serial number
   * @returns DeviceClient attached to a device
   */
  public getDevice(serial: string): DeviceClient {
    return new DeviceClient(this, serial);
  }
}
