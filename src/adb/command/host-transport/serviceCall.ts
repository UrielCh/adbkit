import { Buffer } from 'node:buffer';
import { EOL } from 'node:os';

import Command from '../../command.js';
import { KnownServices } from './servicesList.js';
import { type ParcelVal, ParcelValMap } from './Parcel.js';
import { Utils } from '../../../index.js';

export type ServiceCallArg = ServiceCallArgNumber | ServiceCallArgString | ServiceCallArgNull;

export interface ServiceCallArgNumber {
  type: 'i32' | 'i64' | 'f' | 'd' | 'fd' | 'nfd' | 'afd';
  value: number;
}

export interface ServiceCallArgString {
  type: 's16';
  value: string;
}

export interface ServiceCallArgNull {
  type: 'null';
}

export class ParcelReader {
  private pos = 0;
  constructor(private data: Buffer) {
  }

  /** Read a string or null value; other Parcel value types are not yet supported. */
  public read(): string | null {
    const type: ParcelVal = this.readType();
    switch (type) {
      case ParcelValMap.VAL_NULL:
        return null;
      case ParcelValMap.VAL_STRING:
        return this.readString();
      default:
        throw Error(`Unsupported Parcel value type: ${type}`)
    }
  }

  // https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/os/Parcel.java
  // https://android.googlesource.com/platform/frameworks/native/+/master/libs/binder/ParcelValTypes.h
  // https://android.googlesource.com/platform/frameworks/base/+/master/core/jni/android_os_Parcel.cpp
  // https://android.googlesource.com/platform/frameworks/native/+/jb-dev/libs/binder/Parcel.cpp
  // https://android.googlesource.com/platform/system/libhwbinder/+/o-preview/Parcel.cpp
  // git clone https://android.googlesource.com/platform/system/libhwbinder
  public readType(): ParcelVal {
    const type = this.data.readInt32BE(this.pos);
    this.pos += 4;
    return type as ParcelVal;
  }

  public readString(): string | null {
    let pos = this.pos;
    const data = this.data;
    // 32 bit len in number of char16_t chars
    const chars = data.readInt32BE(pos);
    pos += 4;
    if (chars === -1) {
      this.pos = pos;
      return null;
    }
    if (chars < -1) throw new Error(`Invalid Parcel string length: ${chars}`);
    const block = Math.ceil((chars + 1) / 2);
    if (block * 4 > data.length - pos) throw new RangeError('Truncated Parcel string');
    const dest = Buffer.allocUnsafe(block * 4);

    for (let i = 0; i < block; i++) {
      const src = pos + i * 4;
      const dst = i * 4;
      const code1 = data.readUInt16BE(src);
      const code2 = data.readUInt16BE(src + 2);
      dest.writeUint16LE(code2, dst);
      dest.writeUint16LE(code1, dst + 2);
    }
    this.pos = pos + block * 4;

    return dest.toString('utf16le', 0, chars * 2);
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
    let cmd = `exec:service call ${this.escape(serviceName)} ${this.escape(code)}`
    if (args)
      for (const arg of args) {
        cmd += ` ${arg.type}`;
        if (arg.type === 'null') {
          continue;
        } else if (arg.type === 's16') {
          cmd += ` ${this.escape(arg.value)}`;
        } else {
          cmd += ` ${arg.value}`;
        }
      }
    await this.sendCommand(`${cmd} 2>/dev/null`);
    await this.readOKAY();
    const data = await this.parser.readAll();
    const buf = this._parse(data.toString());
    return new ParcelReader(buf);
  }

  private _parse(value: string): Buffer {
    const data: Buffer[] = [];
    const appendWords = (words: string): void => {
      for (const word of words.match(/[0-9a-f]{8}/gi) ?? []) {
        data.push(Buffer.from(word, 'hex'));
      }
    };
    const lines = /0x[0-9a-f]{8}:\s*((?:[0-9a-f]{8}\s*){1,4})'/gi;
    for (const match of value.matchAll(lines)) appendWords(match[1]);
    if (data.length) return Utils.concatBuffer(data);

    const single = value.match(/Parcel\(\s*((?:[0-9a-f]{8}\s*){1,4})'/i);
    if (single) {
      appendWords(single[1]);
      return Utils.concatBuffer(data);
    }
    // Read Error Parcel
    const m2 = value.match(/Parcel\(Error: 0x([0-9a-f]+) "(.+)"\)/);
    if (m2) {
      throw new Error(`0x${m2[1]} ${m2[2]}`);
    }
    throw new Error(`Fail to parse Parcel`);
    // return Utils.concatBuffer(data);
  }
}
