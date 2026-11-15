import { randomUUID } from 'node:crypto';
import { Duplex, Readable } from 'node:stream';
import { Buffer } from 'node:buffer';

import type * as adbkitMonkey from '@u4/adbkit-monkey';

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
import type { ScrcpyOptions, VideoRecordOptions, VideoRecordResult, VideoEncoderInfo } from './thirdparty/scrcpy/ScrcpyModels.js';
import { RebootType } from './command/host-transport/reboot.js';
import Minicap, { MinicapOptions } from './thirdparty/minicap/Minicap.js';
import STFService, { STFServiceOptions } from './thirdparty/STFService/STFService.js';
import PromiseDuplex from 'promise-duplex';
import { DeviceClientOptions } from '../models/DeviceClientOptions.js';
import ServiceCallCommand, { ParcelReader, ServiceCallArg } from './command/host-transport/serviceCall.js';
import DeviceClientExtra from './DeviceClientExtra.js';
import Stats64 from './sync/stats64.js';
import Entry64 from './sync/entry64.js';
import DevicePackage from './DevicePackage.js';
import { parseMediaCodecsEncoders } from './DeviceMedia.js';
import { syncPull, syncPush, withSync } from './DeviceSyncHelper.js';
import {
  connectMonkeyStream,
  findOrCreateTcpForward,
  isNoUserOptionError,
  parseIpAddresses,
} from './DeviceHelpers.js';

const debug = Utils.debug('adb:client');

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
      return new DeviceClient(this.client, this.serial, { ...this.options, sudo: true });
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
   * List devices with paths
   * ```ts
   * import Adb from '@u4/adbkit';
   * const client = Adb.createClient();
   * const devices = await client.listDevicesWithPaths();
   * for (const d of devices) {
   *   console.log('id:', d.id);
   *   console.log('type:', d.type);
   *   console.log('model:', d.model);
   *   console.log('path:', d.path);
   *   console.log('product:', d.product);
   *   console.log('transportId:', d.transportId);
   * }
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
   *             const deviceClient = device.getClient();
   *             const features = await deviceClient.getFeatures();
   *             if (features['android.hardware.nfc'])
   *                 supportedDevices.push(device.id);
   *         }
   *         console.log('The following devices support NFC:', supportedDevices);
   *     } catch (err) {
   *         console.error('Something went wrong:', err);
   *     }
   * };
   * ```
   */
  public async getFeatures(): Promise<Features> {
    const transport = await this.transport();
    return new hostCmd.GetFeaturesCommand(transport, this.options).execute();
  }

  /**
   * Retrieves the list of packages present on the device. This is analogous to `adb shell pm list packages`. If you just want to see if something's installed, consider using `device.isInstalled()` instead.
   *
   * @param flags Flags to pass to the `pm list packages` command to filter the list
   * -d: filter to only show disabled packages
   * -e: filter to only show enabled packages
   * -s: filter to only show system packages
   * -3: filter to only show third party packages
   * @returns An array of package names installed on the device.
   */
  public async getPackages(flags?: string): Promise<string[]> {
    const transport = await this.transport();
    return new hostCmd.GetPackagesCommand(transport, this.options).execute(flags);
  }

  /**
   * Retrieves the list of running processes.
   *
   * @param flags Optional flags passed to `ps`.
   * @returns A `PsEntry` array.
   */
  public async getPs(...flags: string[]): Promise<Array<Partial<hostCmd.PsEntry>>> {
    const transport = await this.transport();
    return new hostCmd.PsCommand(transport, this.options).execute(...flags);
  }

  /**
   * Call `ip route` command.
   *
   * @returns An `IpRouteEntry` array.
   */
  public async ipRoute(...args: string[]): Promise<Array<hostCmd.IpRouteEntry>> {
    const transport = await this.transport();
    return new hostCmd.IpRouteCommand(transport, this.options).execute(...args);
  }

  /**
   * Call `ip rule` command.
   *
   * @returns An `IpRuleEntry` array.
   */
  public async ipRule(...args: string[]): Promise<Array<hostCmd.IpRuleEntry>> {
    const transport = await this.transport();
    return new hostCmd.IpRuleCommand(transport, this.options).execute(...args);
  }

  /**
   * Retrieves the list of available system services.
   *
   * @returns An `AdbServiceInfo` array.
   */
  public async getServices(): Promise<Array<hostCmd.AdbServiceInfo>> {
    const transport = await this.transport();
    return new hostCmd.ServicesListCommand(transport, this.options).execute();
  }

  /**
   * Checks whether a given system service is registered.
   *
   * @returns `true` if the service is available.
   */
  public async checkService(serviceName: hostCmd.KnownServices | string): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.ServiceCheckCommand(transport, this.options).execute(serviceName);
  }

  /**
   * Execute a `service call` command and return the Parcel response data as a `ParcelReader`.
   */
  public async callServiceRaw(serviceName: hostCmd.KnownServices | string, code: number | string, ...args: Array<ServiceCallArg>): Promise<ParcelReader> {
    const transport = await this.transport();
    return new ServiceCallCommand(transport, this.options).execute(serviceName, code, args);
  }

  /**
   * Attempts to retrieve the IP addresses of the device using `ip addr show`.
   *
   * @param [iface] The network interface. Defaults to `'wlan0'`.
   *
   * @returns The IP addresses as string[] starting with IPv4 then IPv6.
   */
  public async getIpAddress(iface = 'wlan0'): Promise<string[]> {
    const ipData = await this.execOut(['ip', 'addr', 'show', iface], 'utf-8');
    return parseIpAddresses(ipData);
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
   * Get a local TCP port connected to remote socket; tries `preferedPort` first and falls back to an available port if taken.
   * Note if a forward already exists to the same destination with a different port, no new forward will be created.
   * @param remote A string representing the remote endpoint on the device.
   * @param preferedPort the TCP port you would like to get.
   * @returns the used port
   */
  public async tryForwardTCP(remote: string, preferedPort?: number): Promise<number> {
    return findOrCreateTcpForward({
      serial: this.serial,
      remote,
      preferedPort,
      listForwards: () => this.listForwards(),
      forward: (local, rem) => this.forward(local, rem),
    });
  }

  /**
   * Remove the port forward at ADB server host (local). This is analogous to `adb forward --remove <local>`. It's important to note that if you are connected to a remote ADB server, the forward on that host will be removed.
   * @param local A string representing the local endpoint on the ADB host.
   * @returns true
   */
  public async removeForward(local: string): Promise<boolean> {
    const conn = await this.connection();
    return new KillForwardCommand(conn).execute(this.serial, local);
  }

  /**
   * Lists forwarded connections on the device. This is analogous to `adb forward --list`.
   *
   * @returns An array of forward objects with `serial`, `local`, and `remote`.
   */
  public async listForwards(): Promise<Forward[]> {
    const conn = await this.connection();
    return new ListForwardsCommand(conn).execute(this.serial);
  }

  /**
   * Reverses socket connections from the device (remote) to the ADB server host (local). This is analogous to `adb reverse <remote> <local>`.
   * @param remote A string representing the remote endpoint on the device.
   * @param local A string representing the local endpoint on the ADB host.
   * @return true
   */
  public async reverse(remote: string, local: string): Promise<true> {
    const transport = await this.transport();
    return new hostCmd.ReverseCommand(transport).execute(remote, local);
  }

  /**
   * Lists reversed connections on the device. This is analogous to `adb reverse --list`.
   *
   * @returns An array of `Reverse` objects with `remote` and `local`.
   */
  public async listReverses(): Promise<Reverse[]> {
    const transport = await this.transport();
    return new hostCmd.ListReversesCommand(transport).execute();
  }

  /**
   * Return a new connection to ADB.
   */
  private connection(): Promise<Connection> {
    return this.client.connection();
  }

  /**
   * Return a new connection bound to the current device transport.
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
   * @returns A readable stream (`Duplex` / `Socket`) containing the progressive `stdout` of the command. Use with `Adb.util.readAll` to read it into a `Buffer`.
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
   *       const output = await Adb.util.readAll(stream);
   *       console.log('[%s] %s', device.id, output.toString().trim());
   *   }
   *   console.log('Done.');
   * } catch (err) {
   *   console.error('Something went wrong:', err);
   * }
   * ```
   * @example
   * Progressively read the output of a long-running command and terminate it
   * ```ts
   * import Adb from '@u4/adbkit';
   *
   * const client = Adb.createClient();
   * const devices = await client.listDevices();
   * for (const device of devices) {
   *   // logcat just for illustration, prefer device.getClient().openLogcat() in real use
   *   const conn = await device.getClient().shell('logcat');
   *   let line = 0;
   *   conn.on('data', (data) => {
   *     // here `ps` on the device shows the running logcat process
   *     console.log(data.toString());
   *     line += 1;
   *     // close the stream and the running process
   *     // on the device will be gone, gracefully
   *     if (line > 100) conn.end();
   *   });
   *   conn.on('close', () => {
   *     // here `ps` on the device shows the logcat process is gone
   *     console.log('100 lines read already, bye');
   *   });
   * }
   * console.log('Done.');
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
   * Execute a single command and get stdout response as a `Buffer` or `string`.
   * @param command the command to execute
   */
  public async execOut(command: string | ArrayLike<WithToString>): Promise<Buffer>;
  public async execOut(command: string | ArrayLike<WithToString>, encoding: BufferEncoding): Promise<string>;
  public async execOut(command: string | ArrayLike<WithToString>, encoding?: BufferEncoding): Promise<string | Buffer | undefined> {
    const duplex = new PromiseDuplex(await this.exec(command));
    if (encoding) {
      duplex.setEncoding(encoding);
    }
    return duplex.readAll();
  }

  /**
   * Reboots the device.
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
   * @returns The JDWP tracker (`EventEmitter`).
   */
  public async trackJdwp(): Promise<JdwpTracker> {
    const transport = await this.transport();
    return new hostCmd.TrackJdwpCommand(transport, this.options).execute();
  }

  /**
   * Fetches the current **raw** framebuffer (i.e. what is visible on the screen) from the device, and optionally converts it into something more usable by using GraphicsMagick's `gm` command, which must be available in `$PATH` if conversion is desired.
   *
   * @param format The desired output format. Defaults to `'raw'` for raw framebuffer data.
   *
   * @returns The possibly converted framebuffer stream. The stream also has a `meta` property.
   */
  public async framebuffer(format = 'raw'): Promise<FramebufferStreamWithMeta> {
    const transport = await this.transport();
    return new hostCmd.FrameBufferCommand(transport, this.options).execute(format);
  }

  /**
   * Takes a screenshot in PNG format using the built-in `screencap` utility. Falls back to `framebuffer('png')` on older Android devices.
   *
   * @return The PNG stream.
   */
  public async screencap(): Promise<Duplex> {
    const transport = await this.transport();
    try {
      return await new hostCmd.ScreencapCommand(transport, this.options).execute();
    } catch (err) {
      transport.end();
      debug(`Emulating screencap command due to '${err}'`);
      return this.framebuffer('png');
    }
  }

  /**
   * Opens a direct connection to a unix domain socket in the given path.
   *
   * @param path The path to the socket. Prefixed with `'localfilesystem:'` by default, include another prefix (e.g. `'localabstract:'`) in the path to override.
   *
   * @returns The connection (`Duplex`). Call `conn.end()` to end the connection.
   */
  public async openLocal(path: string): Promise<Duplex> {
    const transport = await this.transport();
    return new hostCmd.LocalCommand(transport, this.options).execute(path);
  }

  /**
   * @deprecated Use {@link openLocal} wrapped in `PromiseDuplex` instead.
   */
  public async openLocal2(path: string, _debugCtxt = ''): Promise<PromiseDuplex<Duplex>> {
    return new PromiseDuplex(await this.openLocal(path));
  }

  /**
   * Opens a direct connection to a binary log file, providing access to the raw log data. Note that it is usually much more convenient to use `openLogcat()`.
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
   *
   * @param port The port number to connect to.
   * @param host Optional. The host to connect to.
   *
   * @returns The TCP connection (`Duplex`). Call `conn.end()` to end the connection.
   */
  public async openTcp(port: number, host?: string): Promise<Duplex> {
    const transport = await this.transport();
    return new hostCmd.TcpCommand(transport, this.options).execute(port, host);
  }

  /**
   * Starts the built-in `monkey` utility on the device, connects to it using `openTcp()` and hands the connection to `@u4/adbkit-monkey`.
   *
   * @param port Optional. The device port where you'd like Monkey to run at. Defaults to `1080`.
   *
   * @returns The Monkey client.
   */
  public async openMonkey(port = 1080): Promise<ReturnType<typeof adbkitMonkey.Monkey.connectStream>> {
    return connectMonkeyStream({
      port,
      openTcp: (p) => this.openTcp(p),
      startMonkeyServer: async (p) => {
        const transport = await this.transport();
        return new hostCmd.MonkeyCommand(transport, 1000, this.options).execute(p);
      },
      debug: (msg) => debug(msg),
    });
  }

  /**
   * Calls the `logcat` utility on the device and hands off the connection to `@u4/adbkit-logcat`.
   *
   * @param options Optional. Set `clear: true` to clear logcat before opening the reader.
   *
   * @returns The Logcat client.
   */
  public async openLogcat(options: { clear?: boolean } = {}): Promise<Logcat> {
    const transport = await this.transport();
    const stream = await new hostCmd.LogcatCommand(transport, this.options).execute(options);
    return Logcat.readStream(stream, { fixLineFeeds: false });
  }

  /**
   * Tracks `/proc/stat` and emits CPU load calculations once per second.
   *
   * @returns The `/proc/stat` tracker (`EventEmitter`). Call `stat.end()` to stop tracking.
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
   * @param apk When `String`, interpreted as a path to an APK file. When `Readable`, installs directly from the stream, which must be a valid APK.
   * @returns true
   * @example
   * Install an APK streamed from a URL using native `fetch`
   * ```ts
   * import Adb from '@u4/adbkit';
   * import { Readable } from 'node:stream';
   *
   * const client = Adb.createClient();
   *
   * const test = async () => {
   *   try {
   *     const device = client.getDevice('<serial>');
   *     const res = await fetch('http://example.org/app.apk');
   *     if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
   *     await device.install(Readable.fromWeb(res.body));
   *     console.log('Installed');
   *   } catch (err) {
   *     console.error('Something went wrong:', err);
   *   }
   * };
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
   *             console.log(`Installed ${apk} on ${device.id}`);
   *         }
   *     } catch (err) {
   *         console.error('Something went wrong:', err);
   *     }
   * };
   * ```
   */
  public async install(apk: string | Readable): Promise<boolean> {
    const temp = Sync.temp(typeof apk === 'string' ? apk : `_stream_${randomUUID()}.apk`);
    const transfer = await this.push(apk, temp);
    await transfer.waitForEnd();
    return this.installRemote(temp);
  }

  /**
   * Installs an APK file which must already be located on the device file system, and replaces any previously installed version. Useful if you've previously pushed the file to the device (perhaps to have direct access to `device.push()`'s transfer stats). This is roughly analogous to `adb shell pm install -r <apk>` followed by `adb shell rm -f <apk>`.
   *
   * Note that if the call seems to stall, you may have to accept a dialog on the phone first.
   *
   * @param apk The path to the APK file on the device. The file will be removed when the command completes.
   * @returns true
   */
  public async installRemote(apk: string): Promise<boolean> {
    const transport = await this.transport();
    let installError: unknown;
    let hasInstallError = false;
    try {
      await new hostCmd.InstallCommand(transport, this.options).execute(apk);
    } catch (err) {
      installError = err;
      hasInstallError = true;
      transport.end();
    }
    try {
      await this.execOut(['rm', '-f', apk]);
    } catch (cleanupErr) {
      debug(`Failed to remove temporary APK '${apk}': ${cleanupErr}`);
      if (!hasInstallError) {
        throw cleanupErr;
      }
    }
    if (hasInstallError) {
      throw installError;
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
      if (isNoUserOptionError(err) && options.user !== undefined) {
        return this.startActivity({ ...options, user: undefined });
      }
      throw err;
    }
  }

  /**
   * Starts the configured service on the device. Roughly analogous to `adb shell am startservice <options>`.
   * @param options The service configuration.
   */
  public async startService(options: StartServiceOptions): Promise<boolean> {
    const opts = options.user === undefined ? { ...options, user: 0 } : options;
    try {
      const transport = await this.transport();
      return await new hostCmd.StartServiceCommand(transport, this.options).execute(opts);
    } catch (err) {
      if (isNoUserOptionError(err) && opts.user !== undefined && opts.user !== null) {
        const transport = await this.transport();
        return await new hostCmd.StartServiceCommand(transport, this.options).execute({ ...opts, user: undefined });
      }
      throw err;
    }
  }

  /**
   * Establishes a new Sync connection that can be used to push and pull files. This method provides the most freedom and the best performance for repeated use, but can be a bit cumbersome to use. For simple use cases, consider using `device.stat()`, `device.push()` and `device.pull()`.
   *
   * @returns The Sync client. Call `sync.end()` when done.
   */
  public async syncService(): Promise<Sync> {
    const transport = await this.transport();
    return new hostCmd.SyncCommand(transport, this.options).execute();
  }

  /**
   * A convenience shortcut for `sync.stat()`, mainly for one-off use cases. The Sync client is closed automatically.
   *
   * @param path The path.
   *
   * @returns A `Stats` instance (`mode`, `size`, `mtime`).
   */
  public async stat(path: string): Promise<Stats> {
    return withSync(() => this.syncService(), (sync) => sync.stat(path));
  }

  /**
   * A convenience shortcut for `sync.stat64()`, mainly for one-off use cases. The Sync client is closed automatically.
   *
   * @param path The path.
   *
   * @returns A `Stats64` instance.
   */
  public async stat64(path: string): Promise<Stats64> {
    return withSync(() => this.syncService(), (sync) => sync.stat64(path));
  }

  /**
   * A convenience shortcut for `sync.readdir()`, mainly for one-off use cases. The Sync client is closed automatically.
   *
   * @param path See `sync.readdir()` for details.
   * @returns File entries list
   * @example
   * List files in a folder
   * ```ts
   * import Adb from '@u4/adbkit';
   * const client = Adb.createClient();
   *
   * const test = async () => {
   *     try {
   *         const devices = await client.listDevices();
   *         await Promise.all(devices.map(async (device) => {
   *             const files = await device.getClient().readdir('/sdcard');
   *             for (const file of files) {
   *                 if (file.isFile()) {
   *                     console.log(`[${device.id}] Found file "${file.name}"`);
   *                 }
   *             }
   *         }));
   *         console.log('Done checking /sdcard files on connected devices');
   *     } catch (err) {
   *         console.error('Something went wrong:', err);
   *     }
   * };
   * ```
   */
  public async readdir(path: string): Promise<Entry[]> {
    return withSync(() => this.syncService(), (sync) => sync.readdir(path));
  }

  /**
   * A convenience shortcut for `sync.readdir64()`, mainly for one-off use cases. The Sync client is closed automatically.
   *
   * @param path See `sync.readdir64()` for details.
   * @returns File entries list
   */
  public async readdir64(path: string): Promise<Entry64[]> {
    return withSync(() => this.syncService(), (sync) => sync.readdir64(path));
  }

  /**
   * A convenience shortcut for `sync.pull()`, mainly for one-off use cases. The Sync client is closed automatically.
   *
   * @param path See `sync.pull()` for details.
   *
   * @returns A `PullTransfer` instance.
   *
   * @example
   * Pulling a file from all connected devices
   * ```ts
   * import fs from 'node:fs';
   * import Adb from '@u4/adbkit';
   * const client = Adb.createClient();
   *
   * const test = async () => {
   *     try {
   *         const devices = await client.listDevices();
   *         await Promise.all(devices.map(async (device) => {
   *             const transfer = await device.getClient().pull('/system/build.prop');
   *             const fn = `/tmp/${device.id}.build.prop`;
   *             await new Promise<string>((resolve, reject) => {
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
   *         }));
   *         console.log('Done pulling /system/build.prop from all connected devices');
   *     } catch (err) {
   *         console.error('Something went wrong:', err);
   *     }
   * };
   * ```
   */
  public async pull(path: string): Promise<PullTransfer> {
    return syncPull(() => this.syncService(), path);
  }

  /**
   * A convenience shortcut for `sync.push()`, mainly for one-off use cases. The Sync client is closed automatically.
   *
   * @param contents See `sync.push()` for details.
   * @param path See `sync.push()` for details.
   * @param mode See `sync.push()` for details.
   *
   * @example
   * Pushing a file to all connected devices
   * ```ts
   * import Adb from '@u4/adbkit';
   * const client = Adb.createClient();
   *
   * const test = async () => {
   *     try {
   *         const devices = await client.listDevices();
   *         await Promise.all(devices.map(async (device) => {
   *             const transfer = await device.getClient().push('temp/foo.txt', '/data/local/tmp/foo.txt');
   *             await new Promise<void>((resolve, reject) => {
   *                 transfer.on('progress', (stats) =>
   *                     console.log(`[${device.id}] Pushed ${stats.bytesTransferred} bytes so far`),
   *                 );
   *                 transfer.on('end', () => {
   *                     console.log(`[${device.id}] Push complete`);
   *                     resolve();
   *                 });
   *                 transfer.on('error', reject);
   *             });
   *         }));
   *         console.log('Done pushing foo.txt to all connected devices');
   *     } catch (err) {
   *         console.error('Something went wrong:', err);
   *     }
   * };
   * ```
   */
  public async push(contents: string | Readable, path: string, mode?: number): Promise<PushTransfer> {
    return syncPush(() => this.syncService(), contents, path, mode);
  }

  /**
   * Puts the device's ADB daemon into tcp mode, allowing you to use `adb connect` or `client.connect()` to connect to it. Same as `adb tcpip <port>`.
   *
   * @param port Optional. The port the device should listen on. Defaults to `5555`.
   * @returns The port the device started listening on.
   */
  public async tcpip(port = 5555): Promise<number> {
    const transport = await this.transport();
    return new hostCmd.TcpIpCommand(transport, this.options).execute(port);
  }

  /**
   * Puts the device's ADB daemon back into USB mode. Reverses `tcpip()`. Same as `adb usb`.
   *
   * @returns true
   */
  public async usb(): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.UsbCommand(transport, this.options).execute();
  }

  /**
   * Waits until the device has finished booting. Note that the device must already be seen by ADB.
   *
   * @returns true
   */
  public async waitBootComplete(): Promise<boolean> {
    const transport = await this.transport();
    return new hostCmd.WaitBootCompleteCommand(transport, this.options).execute();
  }

  /**
   * Waits until ADB can see the device.
   *
   * @returns The device ID. Can be useful for chaining.
   */
  public async waitForDevice(): Promise<string> {
    const conn = await this.connection();
    return new WaitForDeviceCommand(conn).execute(this.serial);
  }

  /**
   * Reattaches ADB to the device's ADB USB interface. This re-enables communication between ADB and device, reversing `detach()`.
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
   * Prepare a Scrcpy server; this server must be started with `start()`.
   */
  public scrcpy(options?: Partial<ScrcpyOptions>): Scrcpy {
    return new Scrcpy(this, options);
  }

  /**
   * Record screen video directly using Scrcpy.
   *
   * @param filePath Destination file path (.mp4, .h264, .h265, etc.)
   * @param scrcpyOptions Scrcpy server configuration (videoCodec, maxFps, maxSize, etc.)
   * @param recordOptions Recording control (durationMs, maxFrames, remuxMp4, signal, onProgress)
   */
  public async recordScreen(
    filePath: string,
    scrcpyOptions?: Partial<ScrcpyOptions>,
    recordOptions?: VideoRecordOptions,
  ): Promise<VideoRecordResult> {
    return this.scrcpy(scrcpyOptions).recordToFile(filePath, recordOptions);
  }

  /**
   * List available video encoders on this device.
   * Parses Android's media_codecs configurations.
   */
  public async listVideoEncoders(): Promise<VideoEncoderInfo[]> {
    try {
      const output = await this.execOut(
        'cat /vendor/etc/media_codecs*.xml /system/etc/media_codecs*.xml /etc/media_codecs*.xml 2>/dev/null',
        'utf8',
      );
      return parseMediaCodecsEncoders(output);
    } catch {
      return [];
    }
  }

  /**
   * Prepare a minicap server; this server must be started with `start()`.
   */
  public minicap(options?: Partial<MinicapOptions>): Minicap {
    return new Minicap(this, options);
  }

  /**
   * Prepare an STFService and STFagent; this server must be started with `start()`.
   */
  public STFService(options?: Partial<STFServiceOptions>): STFService {
    return new STFService(this, options);
  }

  #extra?: DeviceClientExtra;
  /**
   * Get extra helper functions.
   * @returns a DeviceClientExtra
   */
  get extra(): DeviceClientExtra {
    if (!this.#extra) {
      this.#extra = new DeviceClientExtra(this);
    }
    return this.#extra;
  }

  /**
   * List packages installed on the device.
   * @param options list all or only third-party apps
   * @returns an array of DevicePackage
   */
  public async listPackages(options?: { thirdparty?: boolean }): Promise<DevicePackage[]> {
    options = options || {};
    let cmd = 'pm list packages';
    if (options.thirdparty) {
      cmd += ' -3';
    }
    const list = await this.execOut(cmd, 'utf-8');
    const packages = [...list.matchAll(/package:([\w\d.]+)/g)];
    return packages.map((m) => new DevicePackage(this, m[1]));
  }
}
