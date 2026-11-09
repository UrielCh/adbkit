import { TcpNetConnectOpts } from 'node:net';

export interface ClientOptions extends TcpNetConnectOpts {
  /**
   * As the sole exception, this option provides the path to the `adb` binary, used for starting the server locally if initial connection fails. Defaults to `'adb'`.
   */
  bin?: string;
  /**
   * When `true` (default), use `ya-webadb` (`@yume-chan/adb`) if available instead of the native `adb` server/binary.
   * Set to `false` to force using the native `adb` server.
   */
  useYaWebAdb?: boolean;
}
