import Client from './adb/client';
// import { Keycode } from './adb/keycode';
import util from './adb/util';
import { ClientOptions } from './models/ClientOptions';

export interface Options {
  host?: string;
  port?: number;
  bin?: string;
}

export default class Adb {
  static util = util;

  /**
   * Create an Adb client
   * @param options customise your adb client
   * @returns a client
   */
  public static createClient(options: Options = {}): Client {
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
}
