import Client from './adb/client.js';
import { ClientOptions } from './models/ClientOptions.js';

export interface AdbOptions {
  /**
   * host to connect default is 127.0.0.1
   */
  host?: string;
  /**
   * The port where the ADB server is listening. Defaults to `5037`.
   */
  port?: number;
  /**
   * As the sole exception, this option provides the path to the `adb` binary, used for starting the server locally if initial connection fails. Defaults to `'adb'`.
   */
  bin?: string;
}

/**
 * Creates a client instance with the provided options. Note that this will not automatically establish a connection, it will only be done when necessary.
 * @param options An object compatible with [Net.connect][net-connect]'s options:
 * **port** The port where the ADB server is listening. Defaults to `5037`.
 * **host** The host of the ADB server. Defaults to `'127.0.0.1'`.
 * **bin** As the sole exception, this option provides the path to the `adb` binary, used for starting the server locally if initial connection fails. Defaults to `'adb'`.
 * 
 * @returns The client instance.
 * @example
 * Function you should import and call first
 * ```ts
 * import { createClient } fronm @u4/adbkit
 * 
 * const client = createClient();
 * ```

 */
export function createClient(options: AdbOptions = { port: 5037 }): Client {
  const opts: ClientOptions = {
    bin: options.bin,
    host: options.host || process.env.ADB_HOST,
    port: options.port || 5037,
  };
  if (!opts.port) {
    const port = parseInt(process.env.ADB_PORT || '5037', 10);
    if (!isNaN(port)) {
      opts.port = port;
    }
  }
  return new Client(opts);
}
