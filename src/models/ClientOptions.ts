import { TcpNetConnectOpts } from 'node:net';

export interface ClientOptions extends TcpNetConnectOpts {
  /**
   * As the sole exception, this option provides the path to the `adb` binary, used for starting the server locally if initial connection fails. Defaults to `'adb'`.
   */
  bin?: string;
  /**
   * Select the transport. `auto` uses ya-webadb for local hosts when available.
   * `ya-webadb` requires the optional dependencies and fails if they are unavailable.
   */
  backend?: 'auto' | 'native' | 'ya-webadb';
  /** Allow ya-webadb to stop the local native ADB server when USB is busy. Defaults to false. */
  stopNativeAdbServerOnUsbBusy?: boolean;
}
