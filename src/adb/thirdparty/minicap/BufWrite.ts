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
    const len = (textData as unknown as Uint8Array).length;
    this.writeUint32BE(len);
    this.append(textData);
    this.pos += len;
  }

  writeInt8(val: number) {
    this.buffer.writeInt8(val, this.pos);
    this.pos += 1;
  }

  append(buf: Buffer) {
    const bufs = [
      this.buffer as unknown as Uint8Array,
      buf as unknown as Uint8Array,
    ];
    this.buffer = Buffer.concat(bufs, bufs[0].length + bufs[1].length);
  }
}
