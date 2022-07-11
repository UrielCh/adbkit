import d from 'debug';
import EventEmitter from 'events';
import Packet from './packet';
import Protocol from '../protocol';
import Client from '../client';
import Socket from './socket';
import ReadableStream = NodeJS.ReadableStream;
import Connection from '../connection';
const debug = d('adb:tcpusb:service');

export class PrematurePacketError extends Error {
  constructor(public packet: Packet) {
    super();
    Object.setPrototypeOf(this, PrematurePacketError.prototype);
    this.name = 'PrematurePacketError';
    this.message = 'Premature packet';
    Error.captureStackTrace(this, Service.PrematurePacketError);
  }
}

export class LateTransportError extends Error {
  constructor() {
    super();
    Object.setPrototypeOf(this, LateTransportError.prototype);
    this.name = 'LateTransportError';
    this.message = 'Late transport';
    Error.captureStackTrace(this, Service.LateTransportError);
  }
}

/**
 * enforce EventEmitter typing
 */
 interface IEmissions {
  end: () => void
  error: (data: Error) => void
}

export default class Service extends EventEmitter {
  public static PrematurePacketError = PrematurePacketError;
  public static LateTransportError = LateTransportError;

  private opened = false;
  private ended = false;
  private transport?: Connection;
  private needAck = false;

  constructor(
    private client: Client,
    private serial: string,
    private localId: number,
    private remoteId: number,
    private socket: Socket,
  ) {
    super();
  }

  public on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  public end(): this {
    if (this.transport) {
      this.transport.end();
    }
    if (this.ended) {
      return this;
    }
    debug('O:A_CLSE');
    const localId = this.opened ? this.localId : 0; // Zero can only mean a failed open
    try {
      // We may or may not have gotten here due to @socket ending, so write
      // may fail.
      this.socket.write(Packet.assemble(Packet.A_CLSE, localId, this.remoteId));
    } catch (error) {
      // ignore error
    }
    // Let it go
    this.transport = undefined;
    this.ended = true;
    this.emit('end');
    return this;
  }

  public async handle(packet: Packet): Promise<boolean> {
    try {
      switch (packet.command) {
        case Packet.A_OPEN:
          this._handleOpenPacket(packet);
          break;
        case Packet.A_OKAY:
          this._handleOkayPacket(packet);
          break;
        case Packet.A_WRTE:
          this._handleWritePacket(packet);
          break;
        case Packet.A_CLSE:
          this._handleClosePacket(packet);
          break;
        default:
          throw new Error(`Unexpected packet ${packet.command}`);
      }
      return true;
    } catch (err) {
      this.emit('error', err as Error);
      this.end();
      return false;
    }
  }

  private async _handleOpenPacket(packet: Packet): Promise<void> {
    debug('I:A_OPEN', packet);
    try {
      const transport = await this.client.getDevice(this.serial).transport()
      this.transport = transport;
      if (this.ended) {
        throw new LateTransportError();
      }
      if (!packet.data)
        throw Error("missing data in packet");
      this.transport.write(Protocol.encodeData(packet.data.slice(0, -1))); // Discard null byte at end
      const reply = await this.transport.parser.readAscii(4);
      switch (reply) {
        case Protocol.OKAY:
          debug('O:A_OKAY');
          this.socket.write(Packet.assemble(Packet.A_OKAY, this.localId, this.remoteId));
          this.opened = true;
          break;
        case Protocol.FAIL:
          throw await this.transport.parser.readError();
        default:
          throw this.transport.parser.unexpected(reply, 'OKAY or FAIL');
      }
      return new Promise<void>((resolve, reject) => {
        if (!this.transport) {
          return reject('transport is closed')
        }
        this.transport.socket
          .on('readable', () => this._tryPush())
          .on('end', resolve)
          .on('error', reject);
        this._tryPush();
      });
    } finally {
      this.end();
    }
  }

  private _handleOkayPacket(packet: Packet): boolean {
    debug('I:A_OKAY', packet);
    if (this.ended) {
      return false;
    }
    if (!this.transport) {
      throw new Service.PrematurePacketError(packet);
    }
    this.needAck = false;
    return this._tryPush();
  }

  private _handleWritePacket(packet: Packet): boolean  {
    debug('I:A_WRTE', packet);
    if (this.ended) {
      return false;
    }
    if (!this.transport) {
      throw new Service.PrematurePacketError(packet);
    }
    if (this.transport && packet.data) {
      this.transport.write(packet.data);
    }
    debug('O:A_OKAY');
    return this.socket.write(Packet.assemble(Packet.A_OKAY, this.localId, this.remoteId));
  }

  private _handleClosePacket(packet: Packet): boolean {
    debug('I:A_CLSE', packet);
    if (this.ended) {
      return false;
    }
    if (!this.transport) {
      throw new Service.PrematurePacketError(packet);
    }
    this.end();
    return true;
  }

  private _tryPush(): boolean {
    if (this.needAck || this.ended || !this.transport) {
      return false;
    }
    const chunk = this._readChunk(this.transport.socket);
    if (chunk) {
      debug('O:A_WRTE');
      this.socket.write(Packet.assemble(Packet.A_WRTE, this.localId, this.remoteId, chunk));
      return (this.needAck = true);
    }
    return false;
  }

  private _readChunk(stream: ReadableStream): Buffer {
    return (stream.read(this.socket.maxPayload) || stream.read()) as Buffer;
  }
}
