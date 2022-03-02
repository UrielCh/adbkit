import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import d from 'debug';
import { promisify } from 'util';
import PacketReader from './packetreader';
import RollingCounter from './rollingcounter';
import Packet from './packet';
import Auth from '../auth';
import Client from '../client';
import * as Net from 'net';
import ServiceMap from './servicemap';
import Service from './service';
import SocketOptions from '../../SocketOptions';

const debug = d('adb:tcpusb:socket');
const UINT32_MAX = 0xffffffff;
const UINT16_MAX = 0xffff;
const AUTH_TOKEN = 1;
const AUTH_SIGNATURE = 2;
const AUTH_RSAPUBLICKEY = 3;
const TOKEN_LENGTH = 20;

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, AuthError.prototype);
    this.name = 'AuthError';
    Error.captureStackTrace(this, Socket.AuthError);
  }
}

class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized access');
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
    this.name = 'UnauthorizedError';
    Error.captureStackTrace(this, Socket.UnauthorizedError);
  }
}

export default class Socket extends EventEmitter {
  public static AuthError = AuthError;
  public static UnauthorizedError = UnauthorizedError;

  private ended = false;
  private reader: PacketReader;
  private authorized = false;
  private syncToken = new RollingCounter(UINT32_MAX);
  private remoteId = new RollingCounter(UINT32_MAX);
  private services = new ServiceMap();
  private remoteAddress?: string;
  private token?: Buffer;
  private signature?: Buffer;
  public version = 1;
  public maxPayload = 4096;

  constructor(
    private readonly client: Client,
    private readonly serial: string,
    private socket: Net.Socket,
    private options: SocketOptions = {},
  ) {
    super();

    let base: SocketOptions;
    (base = this.options).auth || (base.auth = () => Promise.resolve(true));
    this.socket.setNoDelay(true);
    this.reader = new PacketReader(this.socket)
      .on('packet', this._handle.bind(this))
      .on('error', (err) => {
        debug(`PacketReader error: ${err.message}`);
        return this.end();
      })
      .on('end', this.end.bind(this));
    this.remoteAddress = this.socket.remoteAddress;
    this.token = undefined;
    this.signature = undefined;
  }

  public end(): Socket {
    if (this.ended) {
      return this;
    }
    // End services first so that they can send a final payload before FIN.
    this.services.end();
    this.socket.end();
    this.ended = true;
    this.emit('end');
    return this;
  }

  private _error(err: Error): Socket {
    this.emit('error', err);
    return this.end();
  }

  private async _handle(packet: Packet): Promise<boolean> {
    if (this.ended) {
      return false;
    }
    this.emit('userActivity', packet);
    try {
      switch (packet.command) {
        case Packet.A_SYNC:
          return Promise.resolve(this._handleSyncPacket());
        case Packet.A_CNXN:
          return this._handleConnectionPacket(packet);
        case Packet.A_OPEN: {
          const r = this._handleOpenPacket(packet);
          return !!r;
        }
        case Packet.A_OKAY:
        case Packet.A_WRTE:
        case Packet.A_CLSE: {
          const r = await this._forwardServicePacket(packet)
          return !!r;
        }
        case Packet.A_AUTH:
          return this._handleAuthPacket(packet);
        default:
          throw new Error(`Unknown command ${packet.command}`);
      }
    } catch (err) {
      if (err instanceof Socket.AuthError) {
        this.end();
        return false;
      }
      if (err instanceof Socket.UnauthorizedError) {
        this.end();
        return false;
      }
      if (err instanceof Error) {
        this._error(err);
        return false;
      }
      return false;
    }
  }

  private _handleSyncPacket(): boolean {
    // No need to do anything?
    debug('I:A_SYNC');
    debug('O:A_SYNC');
    return this.write(Packet.assemble(Packet.A_SYNC, 1, this.syncToken.next()));
  }

  private async _handleConnectionPacket(packet: Packet): Promise<boolean> {
    debug('I:A_CNXN', packet);
    this.version = Packet.swap32(packet.arg0);
    this.maxPayload = Math.min(UINT16_MAX, packet.arg1);
    const token = await this._createToken();
    this.token = token;
    debug(`Created challenge '${this.token.toString('base64')}'`);
    debug('O:A_AUTH');
    return this.write(Packet.assemble(Packet.A_AUTH, AUTH_TOKEN, 0, this.token));
  }

  private async _handleAuthPacket(packet: Packet): Promise<boolean> {
    debug('I:A_AUTH', packet);
    switch (packet.arg0) {
      case AUTH_SIGNATURE:
        // Store first signature, ignore the rest
        if (packet.data) debug(`Received signature '${packet.data.toString('base64')}'`);
        if (!this.signature) {
          this.signature = packet.data;
        }
        debug('O:A_AUTH');
        const b = this.write(Packet.assemble(Packet.A_AUTH, AUTH_TOKEN, 0, this.token));
        return b;
      case AUTH_RSAPUBLICKEY:
        if (!this.signature) {
          throw new Socket.AuthError('Public key sent before signature');
        }
        if (!packet.data || packet.data.length < 2) {
          throw new Socket.AuthError('Empty RSA public key');
        }
        debug(`Received RSA public key '${packet.data.toString('base64')}'`);
        const key = await Auth.parsePublicKey(this._skipNull(packet.data).toString());
        if (!this.token)
          throw Error('missing token in socket:_handleAuthPacket')
        const digest = this.token.toString('binary');
        const sig = this.signature.toString('binary');
        if (!key.verify(digest, sig)) {
          debug('Signature mismatch');
          throw new Socket.AuthError('Signature mismatch');
        }
        debug('Signature verified');
        if (this.options.auth) {
          try {
            await this.options.auth(key)
          } catch (e) {
            debug('Connection rejected by user-defined auth handler');
            throw new Socket.AuthError('Rejected by user-defined handler');
          }
        }
        const id = await this._deviceId();
        this.authorized = true;
        debug('O:A_CNXN');
        return this.write(Packet.assemble(Packet.A_CNXN, Packet.swap32(this.version), this.maxPayload, id));
      default:
        throw new Error(`Unknown authentication method ${packet.arg0}`);
    }
  }

  private _handleOpenPacket(packet: Packet): Promise<boolean | Service> {
    if (!this.authorized) {
      throw new Socket.UnauthorizedError();
    }
    const remoteId = packet.arg0;
    const localId = this.remoteId.next();
    if (!(packet.data && packet.data.length >= 2)) {
      throw new Error('Empty service name');
    }
    const name = this._skipNull(packet.data);
    debug(`Calling ${name}`);
    const service = new Service(this.client, this.serial, localId, remoteId, this);
    return new Promise<boolean | Service>((resolve, reject) => {
      service.on('error', reject);
      service.on('end', resolve);
      this.services.insert(localId, service);
      debug(`Handling ${this.services.count} services simultaneously`);
      return service.handle(packet);
    })
      .catch(() => true)
      .finally(() => {
        this.services.remove(localId);
        debug(`Handling ${this.services.count} services simultaneously`);
        return service.end();
      });
  }

  private _forwardServicePacket(packet: Packet): Promise<boolean | Service | undefined> {
    if (!this.authorized) {
      throw new Socket.UnauthorizedError();
    }
    const localId = packet.arg1;
    const service = this.services.get(localId);
    if (service) {
      return service.handle(packet);
    } else {
      debug('Received a packet to a service that may have been closed already');
      return Promise.resolve(false);
    }
  }

  public write(chunk: Buffer | string): boolean {
    if (this.ended) {
      return false;
    }
    return this.socket.write(chunk);
  }

  private _createToken(): Promise<Buffer> {
    return promisify(crypto.randomBytes)(TOKEN_LENGTH);
  }

  private _skipNull(data: Buffer): Buffer {
    return data.slice(0, -1); // Discard null byte at end
  }

  private async _deviceId(): Promise<Buffer> {
    debug('Loading device properties to form a standard device ID');
    const properties = await this.client
      .getDevice(this.serial)
      .getProperties();
    const id = (() => {
      const ref = ['ro.product.name', 'ro.product.model', 'ro.product.device'];
      const results = [];
      for (let i = 0, len = ref.length; i < len; i++) {
        const prop = ref[i];
        results.push(`${prop}=${properties[prop]};`);
      }
      return results;
    })().join('');
    return Buffer.from(`device::${id}\x00`);
  }
}
