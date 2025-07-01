import { Buffer } from 'node:buffer';
import { setImmediate } from "node:timers";
import EventEmitter from 'node:events';
import Packet from './packet.js';
import Utils from '../utils.js';

type ReadableStream = NodeJS.ReadableStream;

export class ChecksumError extends Error {
  constructor(public packet: Packet) {
    super();
    Object.setPrototypeOf(this, ChecksumError.prototype);
    this.name = 'ChecksumError';
    this.message = 'Checksum mismatch';
    Error.captureStackTrace(this, PacketReader.ChecksumError);
  }
}

export class MagicError extends Error {
  constructor(public packet: Packet) {
    super();
    Object.setPrototypeOf(this, MagicError.prototype);
    this.name = 'MagicError';
    this.message = 'Magic value mismatch';
    Error.captureStackTrace(this, PacketReader.MagicError);
  }
}

/**
 * enforce EventEmitter typing
 */
 interface IEmissions {
  end: () => void
  error: (data: Error) => void
  packet: (packet: Packet) => void
}

export default class PacketReader extends EventEmitter {
  public static ChecksumError = ChecksumError;
  public static MagicError = MagicError;

  private inBody = false;
  private buffer?: Buffer;
  private packet?: Packet;

  constructor(private stream: ReadableStream) {
    super();
    this.stream.on('readable', this._tryRead.bind(this));
    this.stream.on('error', (err) => { this.emit('error', err); });
    this.stream.on('end', () => { this.emit('end'); });
    setImmediate(this._tryRead.bind(this));
  }

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  private _tryRead(): void {
    while (this._appendChunk()) {
      while (this.buffer) {
        if (this.inBody) {
          if (!this.packet) {
            throw Error('invalid stat packet is missing');
          }
          if (!((this.buffer as unknown as Uint8Array).length >= this.packet.length)) {
            break;
          }
          this.packet.data = this._consume(this.packet.length);
          if (!this.packet.verifyChecksum()) {
            this.emit('error', new PacketReader.ChecksumError(this.packet));
            return;
          }
          this.emit('packet', this.packet);
          this.inBody = false;
        } else {
          if (!((this.buffer as unknown as Uint8Array).length >= 24)) {
            break;
          }
          const header = this._consume(24);
          this.packet = new Packet(
            header.readUInt32LE(0),
            header.readUInt32LE(4),
            header.readUInt32LE(8),
            header.readUInt32LE(12),
            header.readUInt32LE(16),
            header.readUInt32LE(20),
            Buffer.alloc(0),
          );
          if (!this.packet.verifyMagic()) {
            this.emit('error', new PacketReader.MagicError(this.packet));
            return;
          }
          if (this.packet.length === 0) {
            this.emit('packet', this.packet);
          } else {
            this.inBody = true;
          }
        }
      }
    }
  }

  private _appendChunk(): Buffer | null {
    const chunk = this.stream.read() as Buffer;
    if (chunk) {
      if (this.buffer) {
        return (this.buffer = Utils.concatBuffer([this.buffer, chunk]));
      } else {
        return (this.buffer = chunk);
      }
    } else {
      return null;
    }
  }

  private _consume(length: number): Buffer {
    if (!this.buffer)
      return Buffer.from([]);
    const chunk = this.buffer.slice(0, length);
    this.buffer = length === (this.buffer as unknown as Uint8Array).length ? undefined : this.buffer.slice(length);
    return chunk;
  }
}
