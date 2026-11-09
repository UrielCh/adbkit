import { Socket, connect } from 'node:net';
import { promisify } from 'node:util';
import { ObjectEncodingOptions } from 'node:fs';
import EventEmitter from 'node:events';
import { execFile, ExecFileOptions } from 'node:child_process';
import { Buffer } from 'node:buffer';

import Parser from './parser.js';
import dump from './dump.js';
import { ClientOptions } from '../models/ClientOptions.js';
import Client from '../adb/client.js';
import Utils from './utils.js';

const debug = Utils.debug('adb:connection');

/**
 * enforce EventEmitter typing
 */
interface IEmissions {
  connect: () => void
  end: () => void
  drain: () => void
  timeout: () => void
  close: (hadError: boolean) => void
  error: (error: Error) => void
}

export default class Connection extends EventEmitter {
  public socket!: Socket;
  public parser!: Parser;
  private triedStarting: boolean;
  public options: ClientOptions;
  private _errored?: Error

  constructor(private _parent: Client) {
    super();
    this.options = _parent.options || { port: 0 };
    this.triedStarting = false;
  }

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  public get parent(): Client {
    return this._parent;
  }

  public async connect(): Promise<Connection> {
    this.socket = connect(this.options);
    this.socket.setNoDelay(true);
    this.parser = new Parser(this.socket);
    this.socket.on('connect', () => this.emit('connect'));
    this.socket.on('end', () => this.emit('end'));
    this.socket.on('drain', () => this.emit('drain'));
    this.socket.on('timeout', () => this.emit('timeout'));
    this.socket.on('close', (hadError: boolean) => this.emit('close', hadError));

    try {
      await new Promise<void>((resolve, reject) => {
        const onConnect = () => {
          this.socket.off('error', onError);
          resolve();
        };
        const onError = (e: Error) => {
          this.socket.off('connect', onConnect);
          reject(e)
        };
        this.socket.once('connect', onConnect);
        this.socket.once('error', onError);
      });
    } catch (err) {
      if ((err as { code: string }).code === 'ECONNREFUSED' && !this.triedStarting) {
        debug("Connection was refused, let's try starting the server once");
        this.triedStarting = true;
        await this.startServer();
        return this.connect();
      } else {
        this.end();
        throw err;
      }
    }

    // Emit unhandled error events, so that they can be handled on the client.
    // Without this, they would just crash node unavoidably.
    if (this.socket) {
      this.socket.on('error', (err) => {
        if (this.socket && this.socket.listenerCount('error') === 1) {
          this.emit('error', err);
        }
      });
    }
    return this;
  }

  /**
   * added for Mock testing
   */
  public getSocket(): unknown {
    return this.socket;
  }

  public end(): this {
    if (this.socket) {
      this.socket.end();
    }
    return this;
  }

  /**
   * New Writen Call imported from Piotr Roszatycki implementation
   * https://github.com/dex4er/js-promise-writable
   * this method take care of any drain needed.
   * 
   * @param data data to write
   * @returns number of byte writen
   */
  write(data: Buffer): Promise<number> {
    const socket = this.socket
    let rejected = false
    return new Promise((resolve, reject) => {
      // permit exta log to adbkit.dump if ADBKIT_DUMP env variable is set
      const enc = dump(data);
      if (this._errored) {
        const err = this._errored
        this._errored = undefined
        return reject(err)
      }

      if (!socket.writable || socket.destroyed) {
        return reject(new Error("write in a closed socket"))
      }

      const writeErrorHandler = (err: Error) => {
        this._errored = undefined
        rejected = true
        reject(err)
      }

      socket.once("error", writeErrorHandler)

      const canWrite = socket.write(enc as unknown as Uint8Array)

      socket.removeListener("error", writeErrorHandler)

      if (canWrite) {
        if (!rejected) {
          resolve((data as unknown as Uint8Array).length)
        }
      } else {
        const errorHandler = (err: Error): void => {
          this._errored = undefined
          removeListeners()
          reject(err)
        }

        const drainHandler = (): void => {
          removeListeners()
          resolve((data as unknown as Uint8Array).length)
        }

        const closeHandler = (): void => {
          removeListeners()
          resolve((data as unknown as Uint8Array).length)
        }

        const finishHandler = (): void => {
          removeListeners()
          resolve((data as unknown as Uint8Array).length)
        }

        const removeListeners = () => {
          socket.removeListener("close", closeHandler)
          socket.removeListener("drain", drainHandler)
          socket.removeListener("error", errorHandler)
          socket.removeListener("finish", finishHandler)
        }

        socket.on("close", closeHandler)
        socket.on("drain", drainHandler)
        socket.on("error", errorHandler)
        socket.on("finish", finishHandler)
      }
    })
  }

  public startServer(): Promise<{ stdout: string; stderr: string; }> {
    let port = 0;
    if ('port' in this.options) {
      port = this.options.port;
    }
    const args: string[] = port ? ['-P', String(port), 'start-server'] : ['start-server'];
    debug(`Starting ADB server via '${this.options.bin} ${args.join(' ')}'`);
    return this._exec(args, {});
  }

  private _exec(args: string[], options: ObjectEncodingOptions & ExecFileOptions): Promise<{ stdout: string; stderr: string; }> {
    if (!this.options.bin)
      throw new Error('No bin specified');
    debug(`CLI: ${this.options.bin} ${args.join(' ')}`);
    return promisify(execFile)(this.options.bin, args, options) as Promise<{ stdout: string; stderr: string; }>;
  }
}
