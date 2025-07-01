import Connection from './connection.js';
import Protocol from './protocol.js';
import Parser from './parser.js';
import WithToString from '../models/WithToString.js';
import { DeviceClientOptions } from '../models/DeviceClientOptions.js';
import Utils from './utils.js';

const debug = Utils.debug('adb:command');
const RE_SQUOT = /'/g;
const RE_ESCAPE = /([$`\\!"])/g;

export default abstract class Command<T> {
  public readonly options: Partial<DeviceClientOptions>;
  private lastCmd = '';

  get lastCommand(): string {
    return this.lastCmd || '';
  }

  constructor(public connection: Connection, options = {} as Partial<DeviceClientOptions>) {
    this.options = { sudo: false, ...options };
  }

  public get parser(): Parser {
    return this.connection.parser;
  }

  // FIXME(intentional any): not "any" will break it all
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
  public abstract execute(...args: any[]): Promise<T>;

  /**
   * encode message and send it to ADB socket
   * @returns byte write count
   */
  public _send(data: string): Promise<number> {
    this.parser.lastMessage = data;
    const encoded = Protocol.encodeData(data);
    if (debug.enabled) {
      debug(`Send '${encoded}'`);
    }
    return this.connection.write(encoded);
  }

  public escape(arg: number | WithToString): number | string {
    switch (typeof arg) {
      case 'number':
        return arg;
      default:
        return `'${arg.toString().replace(RE_SQUOT, "'\"'\"'")}'`;
    }
  }

  public escapeCompat(arg: number | WithToString): number | string {
    switch (typeof arg) {
      case 'number':
        return arg;
      default:
        return `"${arg.toString().replace(RE_ESCAPE, '\\$1')}"`;
    }
  }

  /**
   * called once per command, only affect shell based command.
   * @returns sent data
   */
  protected async sendCommand(data: string): Promise<string> {
    if (this.options.sudo) {
      if (data.startsWith('shell:')) {
        data = 'shell:su -c \'' + data.substring(6).replace(/'/g, "\\'") + '\'';
      }
      else if (data.startsWith('exec:')) {
        data = 'exec:su -c \'' + data.substring(5).replace(/'/g, "\\'") + '\'';
      }
    }
    this.lastCmd = data;
    await this._send(data);
    return data;
  }

  /**
   * most common action: read for Okey
   */
  protected async readOKAY(): Promise<void> {
    await this.parser.readCode(Protocol.OKAY);
  }
}
