import Command from '../../command.js';
import ShellExecError from './ShellExecError.js';
import Connection from '../../connection.js';

export default class IpRouteCommand extends Command<Array<IpRouteEntry>> {

  constructor(connection: Connection, options?: { sudo?: boolean }) {
    super(connection, options);
  }

  async execute(...args: string[]): Promise<Array<IpRouteEntry>> {
    super.sendCommand(['shell:ip', 'route', ...args].join(' ')); //  2>/dev/null
    await this.readOKAY();
    const data = await this.parser.readAll()
    return this.parseIpRoute(data.toString());
  }

  private parseIpRoute(value: string): Array<IpRouteEntry> {
    if (value.startsWith('Error: ')) {
      throw new ShellExecError(`Sending command:\n${this.lastCommand}\n cause ${value.trim()}`);
    }
    // const value = await this.readValue();

    const lines: string[] = value.split(/[\r\n]+/g).filter(a => a);
    const result: IpRouteEntry[] = [];
    for (const line of lines) {
      result.push(new IpRouteEntry(line));
    }
    return result;
  }
}

const ValidTypes = ['anycast', 'unicast', 'local', 'broadcast', 'multicast', 'throw', 'unreachable', 'prohibit', 'blackhole', 'nat'] as const;
type ValidTypesT = typeof ValidTypes[number];
const ValidTypesSet = new Set<ValidTypesT>(ValidTypes);
type CIDR = string;

/**
 * unix route model
 * ROUTE := NODE_SPEC [ INFO_SPEC ]
 *
 * NODE_SPEC := [ TYPE ] PREFIX [ tos TOS ] [ table TABLE_ID ] [ proto RTPROTO ] [ scope SCOPE ] [ metric METRIC ]
 */
export class IpRouteEntry {
  type?: ValidTypesT;
  dest?: CIDR;
  // prefix?: CIDR;
  via?: string;
  dev?: string;
  mtu?: string;
  // is a number is canned a user
  // is a mapped table name is called as root
  table?: string | number;
  // route expiration time ex: 63352sec
  expires?: string;
  // RTPROTO 
  proto?: 'kernel' | 'boot' | 'static' | number;
  // 
  scope?: 'host' | 'link' | 'global' | number;
  tos?: string;
  src?: string;
  pref?: 'medium' | number;
  metric?: number;
  /**
   * hoplimit [0-255]
   */
  hoplimit?: number;

  constructor(line: string) {
    const words = line.split(' ').filter(a => a);
    if (ValidTypesSet.has(words[0] as ValidTypesT)) {
      this.type = words.shift() as ValidTypesT;
    }

    if (words[0] === 'default') {
      this.dest = words.shift();
    } else if (words[0].match(/^[0-9.]+(\/\d+)?$/)) {
      // IP v4
      this.dest = words.shift();
    } else if (words[0].match(/^[0-9a-f:]+(\/\d+)?$/)) {
      // IP v6
      this.dest = words.shift();
    }

    while (words.length) {
      const next = words.shift();
      const value = words.shift() || '';
      switch (next) {
        case 'dev':
        case 'via':
        case 'src':
        case 'tos':
        case 'mtu':
        case 'expires':
          this[next] = value;
          break;
        case 'metric':
        case 'hoplimit':
          this[next] = Number(value);
          break;
        case 'pref':
        case 'scope':
        case 'table':
        case 'proto':
          if (value.match(/^\d+$/))
            this[next] = Number(value);
          else
            (this[next] as string) = value;
          break;
        default:
          throw Error(`Failed to parse line:\n ${line}\n token: ${next} in ip route response, Fix me in ipRoute.ts`);
      }
    }
  }


  public toString(): string {
    const out: string[] = [];
    for (const field of ['type', 'dest'] as const) {
      const value = this[field];
      if (value)
        out.push(value);
    }
    for (const field of ['via', 'dev', 'table', 'expires', 'proto', 'scope', 'tos', 'src', 'metric', 'pref', 'mtu'] as const) {
      if (this[field] || this[field] === 0) {
        out.push(field);
        out.push(String(this[field]));
      }
    }
    return out.join(' ')
  }

  public clone(): IpRouteEntry {
    return new IpRouteEntry(this.toString());
  }

}
