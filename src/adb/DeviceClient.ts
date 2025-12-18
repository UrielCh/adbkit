import { Duplex } from 'node:stream';
import { ReadStream } from 'node:fs';
import { Buffer } from 'node:buffer';

import * as adbkitMonkey from '@u4/adbkit-monkey';
// import { type Monkey as MonkeyClient } from '@u4/adbkit-monkey';
const { Monkey } = adbkitMonkey;

import { Logcat } from '@u4/adbkit-logcat';
import Connection from './connection.js';
import Sync from './sync.js';
import ProcStat from './proc/stat.js';

import { HostTransportCommand } from './command/host/index.js';
import * as hostCmd from './command/host-transport/index.js';
import {
  AttachCommand,
  DetachCommand,
  ForwardCommand,
  GetDevicePathCommand,
  GetSerialNoCommand,
  GetStateCommand,
  KillForwardCommand,
  ListForwardsCommand,
  WaitForDeviceCommand,
} from './command/host-serial/index.js';
import Forward from '../models/Forward.js';
import Reverse from '../models/Reverse.js';
import StartActivityOptions from '../models/StartActivityOptions.js';
import StartServiceOptions from '../models/StartServiceOptions.js';
import Stats from './sync/stats.js';
import Entry from './sync/entry.js';
import PushTransfer from './sync/pushtransfer.js';
import PullTransfer from './sync/pulltransfer.js';
import { Properties } from '../models/Properties.js';
import { Features } from '../models/Features.js';
import FramebufferStreamWithMeta from '../models/FramebufferStreamWithMeta.js';
import WithToString from '../models/WithToString.js';
import JdwpTracker from './jdwptracker.js';
import { DeviceType } from '../models/Device.js';
import DeviceWithPath from '../models/DeviceWithPath.js';
import Client from './client.js';
import Utils, { BufferEncoding } from './utils.js';
import Scrcpy from './thirdparty/scrcpy/Scrcpy.js';
import type { ScrcpyOptions } from './thirdparty/scrcpy/ScrcpyModels.js';
import { RebootType } from './command/host-transport/reboot.js';
import Minicap, { MinicapOptions } from './thirdparty/minicap/Minicap.js';
import STFService, { STFServiceOptions } from './thirdparty/STFService/STFService.js';
import PromiseDuplex from 'promise-duplex';
import Protocol from './protocol.js';
import { DeviceClientOptions } from '../models/DeviceClientOptions.js';
import ServiceCallCommand, { ParcelReader, ServiceCallArg } from './command/host-transport/serviceCall.js';
import DeviceClientExtra from './DeviceClientExtra.js';
import Stats64 from './sync/stats64.js';
import Entry64 from './sync/entry64.js';
import DevicePackage from './DevicePackage.js';
import getPort from 'get-port';

const debug = Utils.debug('adb:client');

const NoUserOptionError = (err: Error) => err.message.indexOf('--user') !== -1;

export default class DeviceClient {
  private options: DeviceClientOptions;

  constructor(public readonly client: Client, public readonly serial: string, options?: Partial<DeviceClientOptions>) {
    options = options || {};
    const sudo = options.sudo || false;
    this.options = { sudo };
  }

  public sudo(): DeviceClient {
    if (this.options.sudo)
      return this;
    else
      return new DeviceClient(this.client, this.serial, { ...this.options, sudo: true })
  }

  /**
   * Gets the serial number of the device identified by the given serial number. With our API this doesn't really make much sense, but it has been implemented for completeness. _FYI: in the raw ADB protocol you can specify a device in other ways, too._
   *
   * @returns The serial number of the device.
   */
  public async getSerialNo(): Promise<string> {
    const conn = await this.connection();
    return new GetSerialNoCommand(conn).execute(this.serial);
  }

  /**
   * Gets the device path of the device identified by the given serial number.
   * @returns The device path. This corresponds to the device path in `client.listDevicesWithPaths()`.
   * 
   * @example
   * List devices withPath
   * ```ts
   * import Adb from '@u4/adbkit';
   * const client = Adb.createClient();
   * const devices = client.listDevicesWithPaths();
   * devices.then((devices) => {
   *     devices.forEach(function (d) {
   *         console.log('id: ' + d.id);
   *         console.log('type: ' + d.type);
   *         console.log('model ' + d.model);
   *         console.log('path: ' + d.path);
   *         console.log('product: ' + d.product);
   *         console.log('transportId: ' + d.transportId + '\n');
   *     });
   * });
   * ```
   */
  public async getDevicePath(): Promise<DeviceWithPath['path']> {
    const conn = await this.connection();
    return new GetDevicePathCommand(conn).execute(this.serial);
  }
  /**
   * Gets the state of the device identified by the given serial number.
   *
   * @returns The device state. This corresponds to the device type in `client.listDevices()`.
   */
  public async getState(): Promise<DeviceType> {
    const conn = await this.connection();
    return new GetStateCommand(conn).execute(this.serial);
  }

  /**
   * Retrieves the properties of the device identified by the given serial number. This is analogous to `adb shell getprop`.
   *
   * @returns An object of device properties. Each key corresponds to a device property. Convenient for accessing things like `'ro.product.model'`.
   */
  public async getProperties(): Promise<Properties> {
    const transport = await this.transport();
    return new hostCmd.GetPropertiesCommand(transport, this.options).execute();
  }

  /**
   * Retrieves the features of the device identified by the given serial number. This is analogous to `adb shell pm list features`. Useful for checking whether hardware features such as NFC are available (you'd check for `'android.hardware.nfc'`).
   * 
   * @returns An object of device features. Each key corresponds to a device feature, with the value being either `true` for a boolean feature, or the feature value as a string (e.g. `'0x20000'` for `reqGlEsVersion`).
   * 
   * @example
   * Checking for NFC support
   * ```ts
   * import Adb from '@u4/adbkit';
   * 
   * const client = Adb.createClient();
   * 
   * const test = async () => {
   *     try {
   *         const devices = await client.listDevices();
   *         const supportedDevices: string[] = [];
   *         for (const device of devices) {
   *             const client = device.client();
   *             const features = await client.getFeatures(device.id);
   *             if (features['android.hardware.nfc'])
   *                 supportedDevices.push(device.serial);
   *         }
   *         console.log('The following devices support NFC:', supportedDevices);
   *     } catch (err) {
   *         console.error('Something went wrong:', err.stack);
   *     }
   * };
   * ```
   */
  public async getFeatures(): Promise<Features> {
    const transport = await this.transport();
    return new hostCmd.GetFeaturesCommand(transport, this.options).execute();
  }

  /**
   * Retrieves the list of packages present on the device. This is analogous to `adb shell pm list packages`. If you just want to see if something's installed, consider using `client.isInstalled()` instead.
   *
   * @param flags Flags to pass to the `pm list packages` command to filter the list
   * -d: filter to only show disabled packages
   * -e: filter to only show enabled packages
   * -s: filter to only show system packages
   * -3: filter to only show third party packages
   * @returns An object of device features. Each key corresponds to a device feature, with the value being either `true` for a boolean feature, or the feature value as a string (e.g. `'0x20000'` for `reqGlEsVersion`)
   */
  public async getPackages(flags?: string): Promise<string[]> {
    const transport = await this.transport();
    return new hostCmd.GetPackagesCommand(transport, this.options).execute(flags);
  }

  /**
   * Retrieves the list of running Process
   *
   * @param flags Flags to pass to the `ps` command (e.g., '-A', '-ef')
   * @returns a PsEntry array
   */
  public async getPs(...flags: string[]): Promise<Array<Partial<hostCmd.PsEntry>>> {
    const transport = await this.transport();
    return new hostCmd.PsCommand(transport, this.options).execute(...flags);
  }

  /**
   * call ip route command
   *
   * @returns a IpRouteEntry array
   */
  public async ipRoute(...args: string[]): Promise<Array<hostCmd.IpRouteEntry>> {
    const transport = await this.transport();
    return new hostCmd.IpRouteCommand(transport, this.options).execute(...args);
  }

  /**
   * call ip rule command
   *
   * @returns a IpRuleEntry array
   */
  public async ipRule(...args: string[]): Promise<Array<hostCmd.IpRuleEntry>> {
    const transport = await this.transport();
    return new hostCmd.IpRuleCommand(transport, this.options).execute(...args);
  }

  /**
   * Retrieves the list of available services
   *
   * @returns a PsEntry array
   */
  public async getServices(): Promise<Array<hostCmd.AdbServiceInfo>> {
    const transport = await this.transport();
    return new hostCmd.ServicesListCommand(transport, this.options).execute();
  }

  /**
   * Retrieves the list of available services
   *
   * @returns a PsEntry array
   */
  public async checkService(serviceName: hostCmd.KnownServices | string): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.ServiceCheckCommand(transport, this.options).execute(serviceName);
  }

  /**
   * exec a service call command and return Parcel response
   * @returns a PsEntry array
   */
  public async callServiceRaw(serviceName: hostCmd.KnownServices | string, code: number | string, ...args: Array<ServiceCallArg>): Promise<ParcelReader> {
    const transport = await this.transport();
    return new ServiceCallCommand(transport, this.options).execute(serviceName, code, args);
  }

  /**
   * Attemps to retrieve the IP addresses of the device. using `ip addr show` command.
   * 
   * @param [iface] The network interface. Defaults to `'wlan0'`.
   *
   * @returns The IP addresses as string[] starting with IPv4 then IPv6.
   */
  public async getIpAddress(iface = 'wlan0'): Promise<string[]> {
    const ipData = await this.execOut(`ip addr show ${iface}`, 'utf-8');
    const ipV4 = [...ipData.matchAll(/inet ([\d]+\.[\d]+\.[\d]+\.[\d]+)\/\d+/g)].map(m => m[1])
    const ipV6 = [...ipData.matchAll(/inet6 ([0-9a-f:]+)\/\d+/g)].map(m => m[1])
    return [...ipV4, ...ipV6];
  }

  /**
   * Forwards socket connections from the ADB server host (local) to the device (remote). This is analogous to `adb forward <local> <remote>`. It's important to note that if you are connected to a remote ADB server, the forward will be created on that host.
   *
   * @param local A string representing the local endpoint on the ADB host. At time of writing, can be one of:
   * -   `tcp:<port>`
   * -   `localabstract:<unix domain socket name>`
   * -   `localreserved:<unix domain socket name>`
   * -   `localfilesystem:<unix domain socket name>`
   * -   `dev:<character device name>`
   * @param remote A string representing the remote endpoint on the device. At time of writing, can be one of:
   *   Any value accepted by the `local` argument
   *   `jdwp:<process pid>`
   * @returns true
   */
  public async forward(local: string, remote: string): Promise<boolean> {
    const conn = await this.connection();
    return new ForwardCommand(conn).execute(this.serial, local, remote);
  }

  /**
   * Get a localTCP port connected to remote socket, this method will try to get the requested port, but if the port is already taken, will choose an other one.
   * Note if a foward already existe to the same destination with a different port, no new foward will be create.
   * @param preferedPort the TCP port you would like to get.
   * @param remote A string representing the remote endpoint on the device. At time of writing, can be one of:
   *   Any value accepted by the `local` argument
   *   `jdwp:<process pid>`
   * @returns the used port
   */
  public async tryForwardTCP(remote: string, preferedPort?: number): Promise<number> {
    const fwds = await this.listForwards()
    // const usedPort = fwds.filter(a => a.local === local);
    const usedPort = fwds.filter(a => a.remote === remote);
    const prev = usedPort.filter(a => a.remote === remote && a.serial === this.serial);
    if (prev.length) {
      // already connected
      return Number(prev[0].local.substring(4));
    }

    if (preferedPort && !usedPort.length)
      try {
        if (await this.forward(`tcp:${preferedPort}`, remote))
          return preferedPort;
      } catch {
        // need a new port
      }
    const freePort = await getPort();
    await this.forward(`tcp:${freePort}`, remote)
    return freePort;
  }

  /**
   * Remove the port forward at ADB server host (local). This is analogous to adb forward --remove <local>. It's important to note that if you are connected to a remote ADB server, the forward on that host will be removed.
   * @param local A string representing the local endpoint on the ADB host. At time of writing, can be one of: `tcp:<port>`, `localabstract:<unix domain socket name>`, `localreserved:<unix domain socket name>`, `localfilesystem:<unix domain socket name>`, `dev:<character device name>`
   * @returns true
   */
  public async removeForward(local: string): Promise<boolean> {
    const conn = await this.connection();
    return new KillForwardCommand(conn).execute(this.serial, local);
  }

  /**
   * Lists forwarded connections on the device. This is analogous to `adb forward --list`.
   *
   * @returns An array of forward objects with the following properties:
   *   -   **serial** The device serial.
   *   -   **local** The local endpoint. Same format as `client.forward()`'s `local` argument.
   *   -   **remote** The remote endpoint on the device. Same format as `client.forward()`'s `remote` argument.
   */
  public async listForwards(): Promise<Forward[]> {
    const conn = await this.connection();
    return new ListForwardsCommand(conn).execute(this.serial);
  }

  /**
   * Reverses socket connections from the device (remote) to the ADB server host (local). This is analogous to `adb reverse <remote> <local>`. It's important to note that if you are connected to a remote ADB server, the reverse will be created on that host.
   * @param remote A string representing the remote endpoint on the device. At time of writing, can be one of:
   * -   `tcp:<port>`
   * -   `localabstract:<unix domain socket name>`
   * -   `localreserved:<unix domain socket name>`
   * -   `localfilesystem:<unix domain socket name>`
   * @param local A string representing the local endpoint on the ADB host. At time of writing, can be any value accepted by the `remote` argument.
   * @return true
   */
  public async reverse(remote: string, local: string): Promise<true> {
    const transport = await this.transport();
    return new hostCmd.ReverseCommand(transport).execute(remote, local);
  }
  /**
   * Lists forwarded connections on the device. This is analogous to `adb reverse --list`.
   *
   * @returns An array of Reverse objects with the following properties:
   *  -   **remote** The remote endpoint on the device. Same format as `client.reverse()`'s `remote` argument.
   *  -   **local** The local endpoint on the host. Same format as `client.reverse()`'s `local` argument.
   */
  public async listReverses(): Promise<Reverse[]> {
    const transport = await this.transport();
    return new hostCmd.ListReversesCommand(transport).execute();
  }

  /**
   * return a new connection to ADB.
   */
  private connection(): Promise<Connection> {
    return this.client.connection();
  }

  /**
   * return a new connextion to the current Host devices
   */
  public async transport(): Promise<Connection> {
    const conn = await this.connection();
    await new HostTransportCommand(conn).execute(this.serial);
    return conn;
  }

  /**
   * Runs a shell command on the device. Note that you'll be limited to the permissions of the `shell` user, which ADB uses.
   *
   * @param command The shell command to execute. When `String`, the command is run as-is. When `Array`, the elements will be rudimentarily escaped (for convenience, not security) and joined to form a command.
   *
   * @returns A readable stream (`Socket` actually) containing the progressive `stdout` of the command. Use with `adb.util.readAll` to get a readable String from it.
   * @example
   * Read the output of an instantaneous command
   * ```ts
   * import Adb from '@u4/adbkit';
   *
   * try {
   *   const client = Adb.createClient();
   *   const devices = await client.listDevices();
   *   for (const device of devices) {
   *       const stream = await device.getClient().shell('echo $RANDOM');
   *       // Use the readAll() utility to read all the content without
   *       // having to deal with the readable stream. `output` will be a Buffer
   *       // containing all the output.
   *       const output = await adb.util.readAll(stream);
   *       console.log('[%s] %s', device.id, output.toString().trim());
   *   }
   *   console.log('Done.');
   * } catch(err) {
   *   console.error('Something went wrong:', err.stack);
   * }
   * ```
   * @example
   * Progressively read the output of a long-running command and terminate it
   * ```ts
   * import Adb from '@u4/adbkit';
   * 
   * const client = Adb.createClient();
   * const devices = await client.listDevices()
   * for (const device of devices) {
   *   // logcat just for illustration, prefer client.openLogcat in real use 
   *   const conn = await device.getClient().shell('logcat')
   *   let line = 0
   *   conn.on('data', function(data) {
   *     // here `ps` on the device shows the running logcat process
   *     console.log(data.toString())
   *     line += 1
   *     // close the stream and the running process
   *     // on the device will be gone, gracefully
   *     if (line > 100) conn.end()
   *   });
   *   conn.on('close', function() {
   *     // here `ps` on the device shows the logcat process is gone
   *     console.log('100 lines read already, bye')
   *   })
   *  }
   * console.log('Done.')
   * ```
   */
  public async shell(command: string | ArrayLike<WithToString>): Promise<Duplex> {
    const transport = await this.transport();
    return new hostCmd.ShellCommand(transport, this.options).execute(command);
  }

  public async exec(command: string | ArrayLike<WithToString>): Promise<Duplex> {
    const transport = await this.transport();
    return new hostCmd.ExecCommand(transport, this.options).execute(command);
  }

  /**
   * execute a single shell command and get stdout responce as a buffer of a string.
   * @param command the command to execute
   */
  public async execOut(command: string | ArrayLike<WithToString>): Promise<Buffer>;
  public async execOut(command: string | ArrayLike<WithToString>, encoding: BufferEncoding): Promise<string>;
  public async execOut(command: string | ArrayLike<WithToString>, encoding?: BufferEncoding): Promise<string | Buffer | undefined> {
    const duplex = new PromiseDuplex(await (this.exec(command)));
    if (encoding) {
      duplex.setEncoding(encoding);
    }
    return duplex.readAll()
  }

  /**
   * Puts the device into root mode which may be needed by certain shell commands. A remount is generally required after a successful root call. **Note that this will only work if your device supports this feature. Production devices almost never do.**
   *
   * @return true
   */
  public async reboot(type?: RebootType): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.RebootCommand(transport, this.options).execute(type);
  }

  /**
   * Attempts to remount the `/system` partition in read-write mode. This will usually only work on emulators and developer devices.
   *
   * @returns true
   */
  public async remount(): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.RemountCommand(transport, this.options).execute();
  }

  /**
   * Puts the device into root mode which may be needed by certain shell commands. A remount is generally required after a successful root call. **Note that this will only work if your device supports this feature. Production devices almost never do.**
   *
   * @return true
   */
  public async root(): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.RootCommand(transport, this.options).execute();
  }

  /**
   * Starts a JDWP tracker for the given device.
   *
   * Note that as the tracker will keep a connection open, you must call `tracker.end()` if you wish to stop tracking JDWP processes.
   *
   * @returns The JDWP tracker, which is an [`EventEmitter`][node-events]. The following events are available:
   *  -   **add** **(pid)** Emitted when a new JDWP process becomes available, once per pid.
   *  -   **remove** **(pid)** Emitted when a JDWP process becomes unavailable, once per pid.
   *  -   **changeSet** **(changes, pids)** All changes in a single event.
   *    -   **changes** An object with the following properties always present:
   *      -   **added** An array of pids that were added. Empty if none.
   *      -   **removed** An array of pids that were removed. Empty if none.
   *    -   **pids** All currently active pids (including pids from previous runs).
   *  -   **end** Emitted when the underlying connection ends.
   *  -   **error** **(err)** Emitted if there's an error.
   */
  public async trackJdwp(): Promise<JdwpTracker> {
    const transport = await this.transport();
    return new hostCmd.TrackJdwpCommand(transport, this.options).execute();
  }

  /**
   * Fetches the current **raw** framebuffer (i.e. what is visible on the screen) from the device, and optionally converts it into something more usable by using [GraphicsMagick][graphicsmagick]'s `gm` command, which must be available in `$PATH` if conversion is desired. Note that we don't bother supporting really old framebuffer formats such as RGB_565. If for some mysterious reason you happen to run into a `>=2.3` device that uses RGB_565, let us know.
   *
   * Note that high-resolution devices can have quite massive framebuffers. For example, a device with a resolution of 1920x1080 and 32 bit colors would have a roughly 8MB (`1920*1080*4` byte) RGBA framebuffer. Empirical tests point to about 5MB/s bandwidth limit for the ADB USB connection, which means that it can take ~1.6 seconds for the raw data to arrive, or even more if the USB connection is already congested. Using a conversion will further slow down completion.
   *
   * @param format The desired output format. Any output format supported by [GraphicsMagick][graphicsmagick] (such as `'png'`) is supported. Defaults to `'raw'` for raw framebuffer data.
   *
   * @returns The possibly converted framebuffer stream. The stream also has a `meta`.:
   */
  public async framebuffer(format = 'raw'): Promise<FramebufferStreamWithMeta> {
    const transport = await this.transport();
    return new hostCmd.FrameBufferCommand(transport, this.options).execute(format);
  }

  /**
   * Takes a screenshot in PNG format using the built-in `screencap` utility. This is analogous to `adb shell screencap -p`. Sadly, the utility is not available on most Android `<=2.3` devices, but a silent fallback to the `client.framebuffer()` command in PNG mode is attempted, so you should have its dependencies installed just in case.
   *
   * Generating the PNG on the device naturally requires considerably more processing time on that side. However, as the data transferred over USB easily decreases by ~95%, and no conversion being required on the host, this method is usually several times faster than using the framebuffer. Naturally, this benefit does not apply if we're forced to fall back to the framebuffer.
   *
   * For convenience purposes, if the screencap command fails (e.g. because it doesn't exist on older Androids), we fall back to `client.framebuffer(serial, 'png')`, which is slower and has additional installation requirements.
   *
   * @return The PNG stream.
   */
  public async screencap(): Promise<Duplex> {
    const transport = await this.transport();
    try {
      return await new hostCmd.ScreencapCommand(transport, this.options).execute();
    } catch (err) {
      debug(`Emulating screencap command due to '${err}'`);
      return this.framebuffer('png');
    }
  }

  /**
   * Opens a direct connection to a unix domain socket in the given path.
   *
   * @param path The path to the socket. Prefixed with `'localfilesystem:'` by default, include another prefix (e.g. `'localabstract:'`) in the path to override.
   *
   * @returns The connection (i.e. [`net.Socket`][node-net]). Read and write as you please. Call `conn.end()` to end the connection.
   */
  public async openLocal(path: string): Promise<Duplex> {
    const transport = await this.transport();
    return new hostCmd.LocalCommand(transport, this.options).execute(path);
  }

  /**
   * Testing only
   */
  public async openLocal2(path: string, debugCtxt = ''): Promise<PromiseDuplex<Duplex>> {
    const transport = await this.transport();
    const data = path.includes(':') ? path : `localfilesystem:${path}`;
    const duplex = new PromiseDuplex(transport.parser.raw());
    await duplex.write(Protocol.encodeData(data));
    await Utils.waitforReadable(duplex, 0, `openLocal2 ${data} - ${debugCtxt}`);
    const code = await (duplex.read(4) as Promise<Buffer>);
    if (!code.equals(Protocol.bOKAY as unknown as Uint8Array)) {
      if (code.equals(Protocol.bFAIL as unknown as Uint8Array)) throw await transport.parser.readError();
      throw transport.parser.unexpected(code.toString('ascii'), 'OKAY or FAIL');
    }
    return duplex;
  }

  /**
   * Opens a direct connection to a binary log file, providing access to the raw log data. Note that it is usually much more convenient to use the `client.openLogcat()` method, described separately.
   *
   * @param name The name of the log. Available logs include `'main'`, `'system'`, `'radio'` and `'events'`.
   *
   * @returns The binary log stream. Call `log.end()` when you wish to stop receiving data.
   */
  public async openLog(name: string): Promise<Duplex> {
    const transport = await this.transport();
    return new hostCmd.LogCommand(transport, this.options).execute(name);
  }

  /**
     * Opens a direct TCP connection to a port on the device, without any port forwarding required.

     * @param port The port number to connect to.
     * @param host Optional. The host to connect to. Allegedly this is supposed to establish a connection to the given host from the device, but we have not been able to get it to work at all. Skip the host and everything works great.
     * 
     * @returns The TCP connection (i.e. [`net.Socket`][node-net]). Read and write as you please. Call `conn.end()` to end the connection.
     */
  public async openTcp(port: number, host?: string): Promise<Duplex> {
    const transport = await this.transport();
    return new hostCmd.TcpCommand(transport, this.options).execute(port, host);
  }

  /**
   * Starts the built-in `monkey` utility on the device, connects to it using `client.openTcp()` and hands the connection to [adbkit-monkey][adbkit-monkey], a pure Node.js Monkey client. This allows you to create touch and key events, among other things.
   *
   * For more information, check out the [adbkit-monkey][adbkit-monkey] documentation.
   *
   * @param port Optional. The device port where you'd like Monkey to run at. Defaults to `1080`.
   *
   * @returns The Monkey client. Please see the [adbkit-monkey][adbkit-monkey] documentation for details.
   */
  public async openMonkey(port = 1080): Promise<ReturnType<typeof Monkey.connectStream>> {
    const tryConnect = async (times: number): Promise<ReturnType<typeof Monkey.connectStream>> => {
      try {
        const stream: Duplex = await this.openTcp(port);
        const client: ReturnType<typeof Monkey.connectStream> = Monkey.connectStream(stream);
        return client;
      } catch (err) {
        if ((times -= 1)) {
          debug(`Monkey can't be reached, trying ${times} more times`);
          await Utils.delay(100)
          return tryConnect(times);
        } else {
          throw err;
        }
      }
    };
    try {
      return await tryConnect(1);
    } catch {
      const transport = await this.transport();
      const out = await new hostCmd.MonkeyCommand(transport, 1000, this.options).execute(port);
      const monkey = await tryConnect(20);
      return monkey.once('end', () => out.end());
    }
  }

  /**
   * Calls the `logcat` utility on the device and hands off the connection to [adbkit-logcat][adbkit-logcat], a pure Node.js Logcat client. This is analogous to `adb logcat -B`, but the event stream will be parsed for you and a separate event will be emitted for every log entry, allowing for easy processing.
   *
   * For more information, check out the [adbkit-logcat][adbkit-logcat] documentation.
   *
   * @param options Optional. The following options are supported:
   * -   **clear** When `true`, clears logcat before opening the reader. Not set by default.
   *
   * @returns The Logcat client. Please see the [adbkit-logcat][adbkit-logcat] documentation for details.
   */
  public async openLogcat(options: { clear?: boolean } = {}): Promise<Logcat> {
    const transport = await this.transport();
    const stream = await new hostCmd.LogcatCommand(transport, this.options).execute(options);
    return Logcat.readStream(stream, { fixLineFeeds: false });
  }

  /**
   * Tracks `/proc/stat` and emits useful information, such as CPU load.
   * A single sync service instance is used to download the `/proc/stat` file for processing.
   * While doing this does consume some resources, it is very light and should not be a problem.
   * /proc/stat is pulled once per sec, and emit a 'load' event.
   *
   * @returns The `/proc/stat` tracker, which is an [`EventEmitter`][node-events]. Call `stat.end()` to stop tracking. The following events are available:
   *   -   **load** **(loads)** Emitted when a CPU load calculation is available.
   *   -   **loads** CPU loads of **online** CPUs. Each key is a CPU id (e.g. `'cpu0'`, `'cpu1'`) and the value an object with the following properties:
   *     -   **user** Percentage (0-100) of ticks spent on user programs.
   *     -   **nice** Percentage (0-100) of ticks spent on `nice`d user programs.
   *     -   **system** Percentage (0-100) of ticks spent on system programs.
   *     -   **idle** Percentage (0-100) of ticks spent idling.
   *     -   **iowait** Percentage (0-100) of ticks spent waiting for IO.
   *     -   **irq** Percentage (0-100) of ticks spent on hardware interrupts.
   *     -   **softirq** Percentage (0-100) of ticks spent on software interrupts.
   *     -   **steal** Percentage (0-100) of ticks stolen by others.
   *     -   **guest** Percentage (0-100) of ticks spent by a guest.
   *     -   **guestnice** Percentage (0-100) of ticks spent by a `nice`d guest.
   *     -   **total** Total. Always 100.
   */
  public async openProcStat(): Promise<ProcStat> {
    const sync = await this.syncService();
    return new ProcStat(sync);
  }

  /**
   * Deletes all data associated with a package from the device. This is roughly analogous to `adb shell pm clear <pkg>`.
   *
   * @param pkg The package name. This is NOT the APK.
   *
   * @returns true
   */
  public async clear(pkg: string): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.ClearCommand(transport, this.options).execute(pkg);
  }

  /**
   * Installs the APK on the device, replacing any previously installed version. This is roughly analogous to `adb install -r <apk>`.
   *
   * Note that if the call seems to stall, you may have to accept a dialog on the phone first.
   *
   * @param apk When `String`, interpreted as a path to an APK file. When [`Stream`][node-stream], installs directly from the stream, which must be a valid APK.
   * @returns true
   * @example
   * This example requires the [request](https://www.npmjs.org/package/request) module. It also doesn't do any error handling (404 responses, timeouts, invalid URLs etc).
   * ```ts
   * import Adb from '@u4/adbkit';
   * import request from 'request';
   * import { Readable } from 'node:stream';
   * 
   * const client = Adb.createClient();
   * 
   * const test = async () => {
   *   // The request module implements old-style streams, so we have to wrap it.
   *   try {
   *     // request is deprecated
   *     const device = client.getClient('<serial>');
   *     await device.install(new Readable().wrap(request('http://example.org/app.apk') as any) as any)
   *     console.log('Installed')
   *   } catch (err) {
   *     console.error('Something went wrong:', err.stack)
   *   }
   * }
   * ```
   * @example
   * Install an apk to all connected devices
   * ```ts
   * import Adb from '@u4/adbkit';
   * 
   * const client = Adb.createClient();
   * const apk = 'vendor/app.apk';
   * 
   * const test = async () => {
   *     try {
   *         const devices = await client.listDevices();
   *         for (const device of devices) {
   *             await device.getClient().install(apk);
   *             console.log(`Installed ${apk} on all connected devices`);
   *         }
   *     } catch (err) {
   *         console.error('Something went wrong:', err.stack);
   *     }
   * };
   * ```
   */
  public async install(apk: string | ReadStream): Promise<boolean> {
    const temp = Sync.temp(typeof apk === 'string' ? apk : '_stream.apk');
    const transfer = this.push(apk, temp);
    await transfer.waitForEnd();
    const value = await this.installRemote(temp);
    return value
  }

  /**
   * Installs an APK file which must already be located on the device file system, and replaces any previously installed version. Useful if you've previously pushed the file to the device for some reason (perhaps to have direct access to `client.push()`'s transfer stats). This is roughly analogous to `adb shell pm install -r <apk>` followed by `adb shell rm -f <apk>`.
   *
   * Note that if the call seems to stall, you may have to accept a dialog on the phone first.
   *
   * @param apk The path to the APK file on the device. The file will be removed when the command completes.
   * @returns true
   */
  public async installRemote(apk: string): Promise<boolean> {
    const transport = await this.transport();
    try {
      await new hostCmd.InstallCommand(transport, this.options).execute(apk);
    } finally {
      await this.execOut(['rm', '-f', apk]);
    }
    return true;
  }

  /**
   * Uninstalls the package from the device. This is roughly analogous to `adb uninstall <pkg>`.
   *
   * @param pkg The package name. This is NOT the APK.
   * @returns true
   */
  public async uninstall(pkg: string, opts?: hostCmd.UninstallCommandOptions): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.UninstallCommand(transport, this.options).execute(pkg, opts);
  }

  /**
   * Tells you if the specific package is installed or not. This is analogous to `adb shell pm path <pkg>` and some output parsing.
   *
   * @param pkg The package name. This is NOT the APK.
   *
   * @returns `true` if the package is installed, `false` otherwise.
   */
  public async isInstalled(pkg: string): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.IsInstalledCommand(transport, this.options).execute(pkg);
  }

  /**
   * Starts the configured activity on the device. Roughly analogous to `adb shell am start <options>`.
   *
   * @param options The activity configuration.
   */
  public async startActivity(options: StartActivityOptions): Promise<boolean> {
    try {
      const transport = await this.transport();
      return await new hostCmd.StartActivityCommand(transport, this.options).execute(options);
    } catch (err) {
      if (err instanceof NoUserOptionError) {
        options.user = undefined;
        return this.startActivity(options);
      }
      throw err;
    }
  }

  /**
   * Starts the configured service on the device. Roughly analogous to `adb shell am startservice <options>`.
   * @param options The activity configuration.
   */
  public async startService(options: StartServiceOptions): Promise<boolean> {
    try {
      const transport = await this.transport();
      if (!(options.user || options.user === null)) {
        options.user = 0;
      }
      return await new hostCmd.StartServiceCommand(transport, this.options).execute(options);
    } catch (err) {
      if (err instanceof NoUserOptionError) {
        options.user = undefined;
        return this.startService(options);
      }
      throw err;
    }
  }

  /**
   * Establishes a new Sync connection that can be used to push and pull files. This method provides the most freedom and the best performance for repeated use, but can be a bit cumbersome to use. For simple use cases, consider using `client.stat()`, `client.push()` and `client.pull()`.
   *
   * @returns The Sync client. See below for details. Call `sync.end()` when done.
   */
  public async syncService(): Promise<Sync> {
    const transport = await this.transport();
    return new hostCmd.SyncCommand(transport, this.options).execute();
  }

  /**
    * A convenience shortcut for `sync.stat()`, mainly for one-off use cases. The connection cannot be reused, resulting in poorer performance over multiple calls. However, the Sync client will be closed automatically for you, so that's one less thing to worry about.
    *
    * @param path The path.
    * 
    * @returns An [`fs.Stats`][node-fs-stats] instance. While the `stats.is*` methods are available, only the following properties are supported:
    *  -   **mode** The raw mode.
    *  -   **size** The file size.
    *  -   **mtime** The time of last modification as a `Date`.
    */
  public async stat(path: string): Promise<Stats> {
    const sync = await this.syncService();
    try {
      return await sync.stat(path);
    } finally {
      sync.end();
    }
  }

  /**
    * A convenience shortcut for `sync.stat64()`, mainly for one-off use cases. The connection cannot be reused, resulting in poorer performance over multiple calls. However, the Sync client will be closed automatically for you, so that's one less thing to worry about.
     *
     * @param path The path.
     * 
     * @returns An [`fs.Stats`][node-fs-stats] instance. While the `stats.is*` methods are available, only the following properties are supported:
     *  -   **mode** The raw mode.
     *  -   **size** The file size.
     *  -   **mtime** The time of last modification as a `Date`.
     */
  public async stat64(path: string): Promise<Stats64> {
    const sync = await this.syncService();
    try {
      return await sync.stat64(path);
    } finally {
      sync.end();
    }
  }

  /**
   * A convenience shortcut for `sync.readdir()`, mainly for one-off use cases. The connection cannot be reused, resulting in poorer performance over multiple calls. However, the Sync client will be closed automatically for you, so that's one less thing to worry about.
   *
   * @param path See `sync.readdir()` for details.
   * @returns Files Lists
   * @example
   * List files in a folder
   * ```ts
   * import Bluebird from 'bluebird';
   * import Adb from '@u4/adbkit';
   * const client = Adb.createClient();
   * 
   * const test = async () => {
   *     try {
   *         const devices = await client.listDevices();
   *         await Bluebird.map(devices, async (device) => {
   *             const files = await client.readdir(device.id, '/sdcard');
   *             // Synchronous, so we don't have to care about returning at the
   *             // right time
   *             files.forEach((file) => {
   *                 if (file.isFile()) {
   *                     console.log(`[${device.id}] Found file "${file.name}"`);
   *                 }
   *             });
   *         });
   *         console.log('Done checking /sdcard files on connected devices');
   *     } catch (err) {
   *         console.error('Something went wrong:', err.stack);
   *     }
   * };
   * ```
   */
  public async readdir(path: string): Promise<Entry[]> {
    const sync = await this.syncService();
    try {
      return await sync.readdir(path);
    } finally {
      sync.end();
    }
  }

  /**
   * A convenience shortcut for `sync.readdir2()`, mainly for one-off use cases. The connection cannot be reused, resulting in poorer performance over multiple calls. However, the Sync client will be closed automatically for you, so that's one less thing to worry about.
   *
   * @param path See `sync.readdir()` for details.
   * @returns Files Lists
   */
  public async readdir64(path: string): Promise<Entry64[]> {
    const sync = await this.syncService();
    try {
      return await sync.readdir64(path);
    } finally {
      sync.end();
    }
  }

  /**
   * A convenience shortcut for `sync.pull()`, mainly for one-off use cases. The connection cannot be reused, resulting in poorer performance over multiple calls. However, the Sync client will be closed automatically for you, so that's one less thing to worry about.
   *
   * @param path See `sync.pull()` for details.
   *
   * @returns A `PullTransfer` instance.
   * 
   * @example
   * Pulling a file from all cofnnected devices
   * ```ts
   * import Bluebird from 'bluebird';
   * import fs from 'node:fs';
   * import Adb from '@u4/adbkit';
   * const client = Adb.createClient();
   * 
   * const test = async () => {
   *     try {
   *         const devices = await client.listDevices();
   *         await Bluebird.map(devices, async (device) => {
   *             const transfer = await client.pull(device.id, '/system/build.prop');
   *             const fn = `/tmp/${device.id}.build.prop`;
   *             await new Bluebird((resolve, reject) => {
   *                 transfer.on('progress', (stats) =>
   *                     console.log(`[${device.id}] Pulled ${stats.bytesTransferred} bytes so far`),
   *                 );
   *                 transfer.on('end', () => {
   *                     console.log(`[${device.id}] Pull complete`);
   *                     resolve(device.id);
   *                 });
   *                 transfer.on('error', reject);
   *                 transfer.pipe(fs.createWriteStream(fn));
   *             });
   *         });
   *         console.log('Done pulling /system/build.prop from all connected devices');
   *     } catch (err) {
   *         console.error('Something went wrong:', err.stack);
   *     }
   * };
   * ```
   */
  public async pull(path: string): Promise<PullTransfer> {
    const sync = await this.syncService();
    const pullTransfer = await sync.pull(path);
    pullTransfer.waitForEnd().finally(() => sync.end())
    return pullTransfer;
  }

  /**
   * A convenience shortcut for `sync.push()`, mainly for one-off use cases. The connection cannot be reused, resulting in poorer performance over multiple calls. However, the Sync client will be closed automatically for you, so that's one less thing to worry about.
   *
   * @param contents See `sync.push()` for details.
   * @param path See `sync.push()` for details.
   * @param mode See `sync.push()` for details.
   * 
   * @example
   * Pushing a file to all connected devices
   * ```ts
   * import Bluebird from 'bluebird';
   * import Adb from '@u4/adbkit';
   * const client = Adb.createClient();
   * 
   * const test = async () => {
   *     try {
   *         const devices = await client.listDevices();
   *         await Bluebird.map(devices, async (device) => {
   *             const transfer = await client.push(device.id, 'temp/foo.txt', '/data/local/tmp/foo.txt');
   *             await new Bluebird(function (resolve, reject) {
   *                 transfer.on('progress', (stats) =>
   *                     console.log(`[${device.id}] Pushed ${stats.bytesTransferred} bytes so far`),
   *                 );
   *                 transfer.on('end', () => {
   *                     console.log('[${device.id}] Push complete');
   *                     resolve();
   *                 });
   *                 transfer.on('error', reject);
   *             });
   *         });
   *         console.log('Done pushing foo.txt to all connected devices');
   *     } catch (err) {
   *         console.error('Something went wrong:', err.stack);
   *     }
   * };
   * ```
   */
  public push(contents: string | ReadStream, path: string, mode?: number): PushTransfer {
    const transfert = new PushTransfer();
    this.syncService().then((sync) => {
      const subTransfer = sync.push(contents, path, mode);
      subTransfer.on('progress', (stats) => transfert.emit('progress', stats));
      subTransfer.on('error', (err) => transfert.emit('error', err));
      subTransfer.on('end', () => {
        transfert.end();
        sync.end();
      });
    }).catch((err) => {
      transfert.emit('error', err);
    });
    return transfert;
  }

  /**
   * Puts the device's ADB daemon into tcp mode, allowing you to use `adb connect` or `client.connect()` to connect to it. Note that the device will still be visible to ADB as a regular USB-connected device until you unplug it. Same as `adb tcpip <port>`.
   *
   * @param port Optional. The port the device should listen on. Defaults to `5555`.
   * @returns The port the device started listening on.
   */
  public async tcpip(port = 5555): Promise<number> {
    const transport = await this.transport();
    return new hostCmd.TcpIpCommand(transport, this.options).execute(port);
  }

  /**
   * Puts the device's ADB daemon back into USB mode. Reverses `client.tcpip()`. Same as `adb usb`.
   *
   * @returns true
   */
  public async usb(): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.UsbCommand(transport, this.options).execute();
  }

  /**
   * Waits until the device has finished booting. Note that the device must already be seen by ADB. This is roughly analogous to periodically checking `adb shell getprop sys.boot_completed`.
   *
   * @returns true
   */
  public async waitBootComplete(): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.WaitBootCompleteCommand(transport, this.options).execute();
  }

  /**
   * Waits until ADB can see the device. Note that you must know the serial in advance. Other than that, works like `adb -s serial wait-for-device`. If you're planning on reacting to random devices being plugged in and out, consider using `client.trackDevices()` instead.
   *
   * @returns The device ID. Can be useful for chaining.
   */
  public async waitForDevice(): Promise<string> {
    const conn = await this.connection();
    return new WaitForDeviceCommand(conn).execute(this.serial);
  }

  /**
   * Reattaches ADB to the device's ADB USB interface. This re-enables communication between ADB and device, reversing `client.detach()`.
   *
   * @returns true
   */
  public async attach(): Promise<boolean> {
    const conn = await this.connection();
    return new AttachCommand(conn).execute(this.serial);
  }

  /**
   * Detaches ADB's USB interface from ADB. This releases the device from ADB control, allowing other processes to use it.
   *
   * @returns true
   */
  public async detach(): Promise<boolean> {
    const conn = await this.connection();
    return new DetachCommand(conn).execute(this.serial);
  }

  /**
   * prepare a Scrcpy server
   * this server must be started with the start() method
   */
  public scrcpy(options?: Partial<ScrcpyOptions>): Scrcpy {
    const scrcpy = new Scrcpy(this, options);
    return scrcpy;
  }

  /**
   * prepare a minicap server
   * this server must be started with the start() method
   */
  public minicap(options?: Partial<MinicapOptions>): Minicap {
    const minicap = new Minicap(this, options);
    return minicap;
  }

  /**
   * prepare a STFService and STFagent 
   * this server must be started with the start() method
   */
  public STFService(options?: Partial<STFServiceOptions>): STFService {
    const service = new STFService(this, options);
    return service;
  }

  #extra?: DeviceClientExtra;
  /**
   * get extra fucntions
   * @returns an DeviceClientExtra
   */
  get extra(): DeviceClientExtra {
    if (!this.#extra) {
      this.#extra = new DeviceClientExtra(this);
    }
    return this.#extra;
  }

  /**
   * List package installed into the devices,
   * @param options list all or only third party apps
   * @returns an array of DevicePackage
   */
  public async listPackages(options?: { thirdparty?: boolean }): Promise<DevicePackage[]> {
    options = options || {};
    let cmd = 'pm list packages'
    if (options.thirdparty) {
      cmd += ' -3';
    }
    const list = await this.execOut(cmd, 'utf-8');
    const packages = [...list.matchAll(/package:([\w\d.]+)/g)];
    return packages.map(m => new DevicePackage(this, m[1]));
  }
}
