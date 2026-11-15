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
import { listDeviceVideoEncoders, screencapWithFallback } from './DeviceMedia.js';
import { installApk, installRemoteApk, listDevicePackages } from './DevicePackageHelper.js';
import { syncPull, syncPush, withSync } from './DeviceSyncHelper.js';
import {
  connectMonkeyStream,
  findOrCreateTcpForward,
  parseIpAddresses,
  startWithUserFallback,
} from './DeviceHelpers.js';

const debug = Utils.debug('adb:client');

type TransportCommandCtor<T, Args extends unknown[]> = new (
  connection: Connection,
  options?: Partial<DeviceClientOptions>,
) => { execute: (...args: Args) => Promise<T> };

type SerialCommandCtor<T, Args extends unknown[]> = new (
  connection: Connection,
) => { execute: (serial: string, ...args: Args) => Promise<T> };

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

  private async runCommand<T, Args extends unknown[]>(
    CommandCtor: TransportCommandCtor<T, Args>,
    ...args: Args
  ): Promise<T> {
    const transport = await this.transport();
    try {
      return await new CommandCtor(transport, this.options).execute(...args);
    } catch (err) {
      transport.end();
      throw err;
    }
  }

  private async runSerialCommand<T, Args extends unknown[]>(
    CommandCtor: SerialCommandCtor<T, Args>,
    ...args: Args
  ): Promise<T> {
    const conn = await this.connection();
    try {
      return await new CommandCtor(conn).execute(this.serial, ...args);
    } catch (err) {
      conn.end();
      throw err;
    }
  }

  /**
   * Gets the serial number of the device identified by the given serial number. With our API this doesn't really make much sense, but it has been implemented for completeness. _FYI: in the raw ADB protocol you can specify a device in other ways, too._
   *
   * @returns The serial number of the device.
   */
  public getSerialNo(): Promise<string> {
    return this.runSerialCommand(GetSerialNoCommand);
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
  public getDevicePath(): Promise<DeviceWithPath['path']> {
    return this.runSerialCommand(GetDevicePathCommand);
  }

  /**
   * Gets the state of the device identified by the given serial number.
   *
   * @returns The device state. This corresponds to the device type in `client.listDevices()`.
   */
  public getState(): Promise<DeviceType> {
    return this.runSerialCommand(GetStateCommand);
  }

  /**
   * Retrieves the properties of the device identified by the given serial number. This is analogous to `adb shell getprop`.
   *
   * @returns An object of device properties. Each key corresponds to a device property. Convenient for accessing things like `'ro.product.model'`.
   */
  public getProperties(): Promise<Properties> {
    return this.runCommand(hostCmd.GetPropertiesCommand);
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
  public getFeatures(): Promise<Features> {
    return this.runCommand(hostCmd.GetFeaturesCommand);
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
  public getPackages(...flags: string[]): Promise<string[]> {
    return this.runCommand(hostCmd.GetPackagesCommand, ...flags);
  }

  /**
   * Retrieves the list of running processes.
   *
   * @param flags Optional flags passed to `ps`.
   * @returns A `PsEntry` array.
   */
  public getPs(...flags: string[]): Promise<Array<Partial<hostCmd.PsEntry>>> {
    return this.runCommand(hostCmd.PsCommand, ...flags);
  }

  /**
   * Call `ip route` command. Pass each argument separately, e.g. `ipRoute('list', 'table', 'all')`.
   *
   * @returns An `IpRouteEntry` array.
   */
  public ipRoute(...args: string[]): Promise<Array<hostCmd.IpRouteEntry>> {
    return this.runCommand(hostCmd.IpRouteCommand, ...args);
  }

  /**
   * Call `ip rule` command. Pass each argument separately.
   *
   * @returns An `IpRuleEntry` array.
   */
  public ipRule(...args: string[]): Promise<Array<hostCmd.IpRuleEntry>> {
    return this.runCommand(hostCmd.IpRuleCommand, ...args);
  }

  /**
   * Retrieves the list of available system services.
   *
   * @returns An `AdbServiceInfo` array.
   */
  public getServices(): Promise<Array<hostCmd.AdbServiceInfo>> {
    return this.runCommand(hostCmd.ServicesListCommand);
  }

  /**
   * Checks whether a given system service is registered.
   *
   * @returns `true` if the service is available.
   */
  public checkService(serviceName: hostCmd.KnownServices | string): Promise<boolean> {
    return this.runCommand(hostCmd.ServiceCheckCommand, serviceName);
  }

  /**
   * Execute a `service call` command and return the Parcel response data as a `ParcelReader`.
   */
  public callServiceRaw(serviceName: hostCmd.KnownServices | string, code: number | string, ...args: Array<ServiceCallArg>): Promise<ParcelReader> {
    return this.runCommand(ServiceCallCommand, serviceName, code, args);
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
  public forward(local: string, remote: string): Promise<boolean> {
    return this.runSerialCommand(ForwardCommand, local, remote);
  }

  /**
   * Get a local TCP port connected to remote socket; tries `preferedPort` first and falls back to an available port if taken.
   * Note if a forward already exists to the same destination with a different port, no new forward will be created.
   * @param remote A string representing the remote endpoint on the device.
   * @param preferedPort the TCP port you would like to get.
   * @returns the used port
   */
  public tryForwardTCP(remote: string, preferedPort?: number): Promise<number> {
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
  public removeForward(local: string): Promise<boolean> {
    return this.runSerialCommand(KillForwardCommand, local);
  }

  /**
   * Lists forwarded connections on the device. This is analogous to `adb forward --list`.
   *
   * @returns An array of forward objects with `serial`, `local`, and `remote`.
   */
  public listForwards(): Promise<Forward[]> {
    return this.runSerialCommand(ListForwardsCommand);
  }

  /**
   * Reverses socket connections from the device (remote) to the ADB server host (local). This is analogous to `adb reverse <remote> <local>`.
   * @param remote A string representing the remote endpoint on the device.
   * @param local A string representing the local endpoint on the ADB host.
   * @return true
   */
  public reverse(remote: string, local: string): Promise<true> {
    return this.runCommand(hostCmd.ReverseCommand, remote, local);
  }

  /**
   * Lists reversed connections on the device. This is analogous to `adb reverse --list`.
   *
   * @returns An array of `Reverse` objects with `remote` and `local`.
   */
  public listReverses(): Promise<Reverse[]> {
    return this.runCommand(hostCmd.ListReversesCommand);
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
    try {
      await new HostTransportCommand(conn).execute(this.serial);
      return conn;
    } catch (err) {
      conn.end();
      throw err;
    }
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
  public shell(command: string | ArrayLike<WithToString>): Promise<Duplex> {
    return this.runCommand(hostCmd.ShellCommand, command);
  }

  public exec(command: string | ArrayLike<WithToString>): Promise<Duplex> {
    return this.runCommand(hostCmd.ExecCommand, command);
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
  public reboot(type?: RebootType): Promise<boolean> {
    return this.runCommand(hostCmd.RebootCommand, type);
  }

  /**
   * Attempts to remount the `/system` partition in read-write mode. This will usually only work on emulators and developer devices.
   *
   * @returns true
   */
  public remount(): Promise<boolean> {
    return this.runCommand(hostCmd.RemountCommand);
  }

  /**
   * Puts the device into root mode which may be needed by certain shell commands. A remount is generally required after a successful root call. **Note that this will only work if your device supports this feature. Production devices almost never do.**
   *
   * @return true
   */
  public root(): Promise<boolean> {
    return this.runCommand(hostCmd.RootCommand);
  }

  /**
   * Starts a JDWP tracker for the given device.
   *
   * Note that as the tracker will keep a connection open, you must call `tracker.end()` if you wish to stop tracking JDWP processes.
   *
   * @returns The JDWP tracker (`EventEmitter`).
   */
  public trackJdwp(): Promise<JdwpTracker> {
    return this.runCommand(hostCmd.TrackJdwpCommand);
  }

  /**
   * Fetches the current **raw** framebuffer (i.e. what is visible on the screen) from the device, and optionally converts it into something more usable by using GraphicsMagick's `gm` command, which must be available in `$PATH` if conversion is desired.
   *
   * @param format The desired output format. Defaults to `'raw'` for raw framebuffer data.
   *
   * @returns The possibly converted framebuffer stream. The stream also has a `meta` property.
   */
  public framebuffer(format = 'raw'): Promise<FramebufferStreamWithMeta> {
    return this.runCommand(hostCmd.FrameBufferCommand, format);
  }

  /**
   * Takes a screenshot in PNG format using the built-in `screencap` utility. Falls back to `framebuffer('png')` on older Android devices.
   *
   * @return The PNG stream.
   */
  public screencap(): Promise<Duplex> {
    return screencapWithFallback({
      getTransport: () => this.transport(),
      options: this.options,
      fallback: () => this.framebuffer('png'),
      debug: (msg) => debug(msg),
    });
  }

  /**
   * Opens a direct connection to a unix domain socket in the given path.
   *
   * @param path The path to the socket. Prefixed with `'localfilesystem:'` by default, include another prefix (e.g. `'localabstract:'`) in the path to override.
   *
   * @returns The connection (`Duplex`). Call `conn.end()` to end the connection.
   */
  public openLocal(path: string): Promise<Duplex> {
    return this.runCommand(hostCmd.LocalCommand, path);
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
  public openLog(name: string): Promise<Duplex> {
    return this.runCommand(hostCmd.LogCommand, name);
  }

  /**
   * Opens a direct TCP connection to a port on the device, without any port forwarding required.
   *
   * @param port The port number to connect to.
   * @param host Optional. The host to connect to.
   *
   * @returns The TCP connection (`Duplex`). Call `conn.end()` to end the connection.
   */
  public openTcp(port: number, host?: string): Promise<Duplex> {
    return this.runCommand(hostCmd.TcpCommand, port, host);
  }

  /**
   * Starts the built-in `monkey` utility on the device, connects to it using `openTcp()` and hands the connection to `@u4/adbkit-monkey`.
   *
   * @param port Optional. The device port where you'd like Monkey to run at. Defaults to `1080`.
   *
   * @returns The Monkey client.
   */
  public openMonkey(port = 1080): Promise<ReturnType<typeof adbkitMonkey.Monkey.connectStream>> {
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
    const stream = await this.runCommand(hostCmd.LogcatCommand, options);
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
  public clear(pkg: string): Promise<boolean> {
    return this.runCommand(hostCmd.ClearCommand, pkg);
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
  public install(apk: string | Readable): Promise<boolean> {
    return installApk({
      apk,
      push: (contents, path) => this.push(contents, path),
      installRemote: (remotePath) => this.installRemote(remotePath),
    });
  }

  /**
   * Installs an APK file which must already be located on the device file system, and replaces any previously installed version. Useful if you've previously pushed the file to the device (perhaps to have direct access to `device.push()`'s transfer stats). This is roughly analogous to `adb shell pm install -r <apk>` followed by `adb shell rm -f <apk>`.
   *
   * Note that if the call seems to stall, you may have to accept a dialog on the phone first.
   *
   * @param apk The path to the APK file on the device. The file will be removed when the command completes.
   * @returns true
   */
  public installRemote(apk: string): Promise<boolean> {
    return installRemoteApk({
      apk,
      getTransport: () => this.transport(),
      options: this.options,
      execOut: (cmd) => this.execOut(cmd),
      debug: (msg) => debug(msg),
    });
  }

  /**
   * Uninstalls the package from the device. This is roughly analogous to `adb uninstall <pkg>`.
   *
   * @param pkg The package name. This is NOT the APK.
   * @param opts Optional uninstall flags and failure handling (`throwOnFailure`).
   * @returns `true` on success, or `true` on non-`DELETE_FAILED_DEVICE_POLICY_MANAGER` failures unless `opts.throwOnFailure` is `true` (in which case `UninstallError` is thrown).
   */
  public uninstall(pkg: string, opts?: hostCmd.UninstallCommandOptions): Promise<boolean> {
    return this.runCommand(hostCmd.UninstallCommand, pkg, opts);
  }

  /**
   * Tells you if the specific package is installed or not. This is analogous to `adb shell pm path <pkg>` and some output parsing.
   *
   * @param pkg The package name. This is NOT the APK.
   *
   * @returns `true` if the package is installed, `false` otherwise.
   */
  public isInstalled(pkg: string): Promise<boolean> {
    return this.runCommand(hostCmd.IsInstalledCommand, pkg);
  }

  /**
   * Starts the configured activity on the device. Roughly analogous to `adb shell am start <options>`.
   *
   * @param options The activity configuration.
   */
  public startActivity(options: StartActivityOptions): Promise<boolean> {
    return startWithUserFallback(options, undefined, (opts) => this.runCommand(hostCmd.StartActivityCommand, opts));
  }

  /**
   * Starts the configured service on the device. Roughly analogous to `adb shell am startservice <options>`.
   * @param options The service configuration.
   */
  public startService(options: StartServiceOptions): Promise<boolean> {
    return startWithUserFallback(options, 0, (opts) => this.runCommand(hostCmd.StartServiceCommand, opts));
  }

  /**
   * Establishes a new Sync connection that can be used to push and pull files. This method provides the most freedom and the best performance for repeated use, but can be a bit cumbersome to use. For simple use cases, consider using `device.stat()`, `device.push()` and `device.pull()`.
   *
   * @returns The Sync client. Call `sync.end()` when done.
   */
  public syncService(): Promise<Sync> {
    return this.runCommand(hostCmd.SyncCommand);
  }

  /**
   * A convenience shortcut for `sync.stat()`, mainly for one-off use cases. The Sync client is closed automatically.
   *
   * @param path The path.
   *
   * @returns A `Stats` instance (`mode`, `size`, `mtime`).
   */
  public stat(path: string): Promise<Stats> {
    return withSync(() => this.syncService(), (sync) => sync.stat(path));
  }

  /**
   * A convenience shortcut for `sync.stat64()`, mainly for one-off use cases. The Sync client is closed automatically.
   *
   * @param path The path.
   *
   * @returns A `Stats64` instance.
   */
  public stat64(path: string): Promise<Stats64> {
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
  public readdir(path: string): Promise<Entry[]> {
    return withSync(() => this.syncService(), (sync) => sync.readdir(path));
  }

  /**
   * A convenience shortcut for `sync.readdir64()`, mainly for one-off use cases. The Sync client is closed automatically.
   *
   * @param path See `sync.readdir64()` for details.
   * @returns File entries list
   */
  public readdir64(path: string): Promise<Entry64[]> {
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
  public pull(path: string): Promise<PullTransfer> {
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
  public push(contents: string | Readable, path: string, mode?: number): Promise<PushTransfer> {
    return syncPush(() => this.syncService(), contents, path, mode);
  }

  /**
   * Puts the device's ADB daemon into tcp mode, allowing you to use `adb connect` or `client.connect()` to connect to it. Same as `adb tcpip <port>`.
   *
   * @param port Optional. The port the device should listen on. Defaults to `5555`.
   * @returns The port the device started listening on.
   */
  public tcpip(port = 5555): Promise<number> {
    return this.runCommand(hostCmd.TcpIpCommand, port);
  }

  /**
   * Puts the device's ADB daemon back into USB mode. Reverses `tcpip()`. Same as `adb usb`.
   *
   * @returns true
   */
  public usb(): Promise<boolean> {
    return this.runCommand(hostCmd.UsbCommand);
  }

  /**
   * Waits until the device has finished booting. Note that the device must already be seen by ADB.
   *
   * @returns true
   */
  public waitBootComplete(): Promise<boolean> {
    return this.runCommand(hostCmd.WaitBootCompleteCommand);
  }

  /**
   * Waits until ADB can see the device.
   *
   * @returns The device ID. Can be useful for chaining.
   */
  public waitForDevice(): Promise<string> {
    return this.runSerialCommand(WaitForDeviceCommand);
  }

  /**
   * Reattaches ADB to the device's ADB USB interface. This re-enables communication between ADB and device, reversing `detach()`.
   *
   * @returns true
   */
  public attach(): Promise<boolean> {
    return this.runSerialCommand(AttachCommand);
  }

  /**
   * Detaches ADB's USB interface from ADB. This releases the device from ADB control, allowing other processes to use it.
   *
   * @returns true
   */
  public detach(): Promise<boolean> {
    return this.runSerialCommand(DetachCommand);
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
  public recordScreen(
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
  public listVideoEncoders(): Promise<VideoEncoderInfo[]> {
    return listDeviceVideoEncoders((cmd, encoding) => this.execOut(cmd, encoding));
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
  public listPackages(options?: { thirdparty?: boolean }): Promise<DevicePackage[]> {
    return listDevicePackages(this, (...flags) => this.getPackages(...flags), options);
  }
}
