import Command from '../../command';
import { KnownServices } from './servicesList';
import { EOL } from 'os';

export type ServiceCallArg = ServiceCallArgNumber | ServiceCallArgString | ServiceCallArgNull;

export class ServiceCallArgNumber {
  type: 'i32' | 'i64' | 'f' | 'd' | 'fd' | 'nfd' | 'afd';
  value: number;
}

export class ServiceCallArgString {
  type: 's16';
  value: string;
}

export class ServiceCallArgNull {
  type: 'null';
}

export class ParcelReader {
  private pos = 0;
  constructor(private data: Buffer) {
  }

  // https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/os/Parcel.java
  // https://android.googlesource.com/platform/frameworks/base/+/master/core/jni/android_os_Parcel.cpp
  // https://android.googlesource.com/platform/frameworks/native/+/jb-dev/libs/binder/Parcel.cpp
  public readType(): number {
    const type = this.data.readInt32BE(this.pos);
    this.pos += 4;
    return type;
  }

  public readString(): string {
    let pos = this.pos;
    const data = this.data;
    // 32 bit len in number of char16_t chars
    const chars = data.readInt32BE(pos);
    pos += 4;
    const block = (chars + 1) >> 1;
    const dest = Buffer.allocUnsafe(block  * 4);

    for (let i = 0; i < block; i++) {
      const src = pos + i * 4;
      const dst = i * 4;
      const code1 = data.readUInt16BE(src);
      const code2 = data.readUInt16BE(src + 2);
      dest.writeUint16LE(code2, dst);
      dest.writeUint16LE(code1, dst + 2);
    }
    this.pos += pos + block * 4;

    if (chars & 1) {
      return dest.toString('utf16le', 0, dest.length - 1);
    } else {
      return dest.toString('utf16le');
    }
  }

  public dump(): string {
    const out: string[] = [];
    let p = 0;
    while (p < this.data.length) {
      out.push(this.data.subarray(p, p + 16).toString('hex').replace(/(....)/g, '$1 '));
      p += 16;
    }
    return out.join(EOL);
  }
}

/**
 * service call SERVICE CODE [i32 N | i64 N | f N | d N | s16 STR | null | fd f | nfd n | afd f ] ...
 */
export default class ServiceCallCommand extends Command<ParcelReader> {
  async execute(serviceName: KnownServices | string, code: number | string, args?: Array<ServiceCallArg>): Promise<ParcelReader> {
    let cmd = `exec:service call ${serviceName} ${code}`
    if (args)
      for (const arg of args) {
        cmd += ` ${arg.type}`;
        if (arg.type === 'null') {
          continue;
        } else if (arg.type === 's16') {
          let str = arg.value.replace(/"/g, '\\"');
          str = str.replace(/\$/g, '\\$'); // should replace {} and {} ?
          cmd += ` "${str}"`;
        } else {
          cmd += ` ${arg.value}`;
        }
      }
    this.sendCommand(`${cmd} 2>/dev/null`);
    await this.readOKAY();
    const data = await this.parser.readAll();
    const buf = this._parse(data.toString());
    return new ParcelReader(buf);
  }

  private _parse(value: string): Buffer {
    const RE_HEX = /0x[0-9a-f]{8}: ([0-9a-f]{8}) ([0-9a-f ]{8})? ([0-9a-f ]{8}) ([0-9a-f ]{8}) '.{16}'/gm;
    const data: Buffer[] = [];

    for (; ;) {
      const match = RE_HEX.exec(value);
      if (match) {
        for (let i = 1; i <= 4; i++) {
          const chunk = match[i].trim();
          if (!chunk)
            break;
          data.push(Buffer.from(chunk, 'hex'));
        }
      } else {
        break;
      }
    }
    if (data.length) {
      return Buffer.concat(data);
    }
    // sinngle line Parcel
    const m1 = value.match(/Parcel\(([0-9a-f]{8}) ([0-9a-f ]{8})? ([0-9a-f ]{8}) ([0-9a-f ]{8}) '.{16}'\)/);
    if (m1) {
      for (let i = 1; i <= 4; i++) {
        const chunk = m1[i].trim();
        if (!chunk)
          break;
        data.push(Buffer.from(chunk, 'hex'));
      }
      return Buffer.concat(data);
    }
    // Read Error Parcel
    const m2 = value.match(/Parcel\(Error: 0x([0-9a-f]+) "(.+)"\)/);
    if (m2) {
      throw new Error(`0x${m2[1]} ${m2[2]}`);
    }
    //return Buffer.concat(data);
  }
}
