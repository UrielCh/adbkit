/**
 * utils only used by third party
 */

import PromiseDuplex from 'promise-duplex';
import { Duplex } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import Utils from '../../adb/utils.js';
import DeviceClient from '../DeviceClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default class ThirdUtils {
  /**
   * use to debug external apk output
   * @param duplex process IO
   * @param name for display only
   * @returns resolve on stream closed
   */
  static async dumpReadable(duplex: PromiseDuplex<Duplex>, name: string): Promise<void> {
    try {
      const prefix = name + ':';
      for (; ;) {
        await Utils.waitforReadable(duplex);
        const data = await duplex.read();
        if (data) {
          const msg = data.toString();
          console.log(prefix, msg.trim());
        }
      }
    } catch {
      // End
      return;
    }
  }

  static get resourceDir() {
    return path.join(__dirname, '..', '..', '..', 'bin');
  }

  /**
   * get fullpath from a ressource file.
   * @param fileName filename
   * @returns full path within the ressource folder
   */
  static getResourcePath(fileName: string): string {
    const fullPath = path.join(ThirdUtils.resourceDir, fileName);
    return fullPath;
  }

  static async getScreenSize(client: DeviceClient): Promise<{ x: number, y: number }> {
    const str = await client.execOut('wm size', 'utf8');
    const m = str.match(/(\d+)x(\d+)/);
    if (!m) throw Error('can not get device size info');
    return { x: Number(m[1]), y: Number(m[2]) }
  }
}