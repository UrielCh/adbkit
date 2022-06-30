import EventEmitter from 'events';
import Connection from './connection';

import {
  HostVersionCommand,
  HostConnectCommand,
  HostDevicesCommand,
  HostDevicesWithPathsCommand,
  HostDisconnectCommand,
  HostTrackDevicesCommand,
  HostKillCommand,
} from './command/host';
import TcpUsbServer from './tcpusb/server';
import Device from '../models/Device';
import { ClientOptions } from '../models/ClientOptions';
import SocketOptions from '../models/SocketOptions';
import Tracker from './tracker';
import DeviceWithPath from '../models/DeviceWithPath';
import DeviceClient from './DeviceClient';

/**
 * enforce EventEmitter typing
 */
 interface IEmissions {
  error: (data: Error) => void
}

export default class Client extends EventEmitter {
  public readonly options: ClientOptions;
  public readonly host: string;
  public readonly port: number | string;
  public readonly bin: string;

  constructor({ host = '127.0.0.1', port = 5037, bin = 'adb' }: ClientOptions = { port: 5037 }) {
    super();
    this.host = host;
    this.port = port;
    this.bin = bin;
    this.options = { host, port, bin };
  }

  public on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

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
   * import Adb from '@u4/adbkit';
   * const client = Adb.createClient();
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
   * list connected device
   * @returns list of device serial number + types
   */
  public async listDevices(): Promise<Device[]> {
    const conn = await this.connection();
    return new HostDevicesCommand(conn).execute();
  }

  public async listDevicesWithPaths(): Promise<DeviceWithPath[]> {
    const conn = await this.connection();
    return new HostDevicesWithPathsCommand(conn).execute();
  }

  /**
   * Gets a device tracker. Events will be emitted when devices are added, removed, or their type changes (i.e. to/from `offline`). Note that the same events will be emitted for the initially connected devices also, so that you don't need to use both `client.listDevices()` and `client.trackDevices()`.
   * Note that as the tracker will keep a connection open, you must call `tracker.end()` if you wish to stop tracking devices.
   */

  public async trackDevices(): Promise<Tracker> {
    const conn = await this.connection();
    return new HostTrackDevicesCommand(conn).execute();
  }

  public async kill(): Promise<boolean> {
    const conn = await this.connection();
    return new HostKillCommand(conn).execute();
  }

  public getDevice(serial: string): DeviceClient {
    return new DeviceClient(this, serial);
  }
}
