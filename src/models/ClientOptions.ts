import { TcpNetConnectOpts } from 'node:net';

export interface ClientOptions extends TcpNetConnectOpts {
  /**
   * As the sole exception, this option provides the path to the `adb` binary, used for starting the server locally if initial connection fails. Defaults to `'adb'`.
   */
  bin?: string;
}
