import { Buffer } from 'node:buffer';

/**
 * help writing message
 */
export class BufWrite {
  public buffer: Buffer;
  public pos = 0;

  constructor(len: number) {
    this.buffer = Buffer.allocUnsafe(len);
  }

  writeBigUint64BE(val: bigint) {
    this.buffer.writeBigUint64BE(val, this.pos);
    this.pos += 8;
  }

  writeUint32BE(val: number) {
    this.buffer.writeUint32BE(val, this.pos);
    this.pos += 4;
  }
  writeInt32BE(val: number) {
    this.buffer.writeInt32BE(val, this.pos);
    this.pos += 4;
  }

  writeUint16BE(val: number) {
    this.buffer.writeUint16BE(val, this.pos);
    this.pos += 2;
  }

  writeInt16BE(val: number) {
    this.buffer.writeInt16BE(val, this.pos);
    this.pos += 2;
  }

  writeUint8(val: number) {
    this.buffer.writeUint8(val, this.pos);
    this.pos += 1;
  }

  writeString(text: string) {
    const textData = Buffer.from(text, 'utf8');
    const len = textData.length;
    this.writeUint32BE(len);
    this.append(textData);
    this.pos += len;
  }

  writeInt8(val: number) {
    this.buffer.writeInt8(val, this.pos);
    this.pos += 1;
  }

  append(buf: Buffer) {
    this.buffer = Buffer.concat([this.buffer, buf], this.buffer.length + buf.length);
  }
}
