import fs from 'node:fs';
import Path from 'node:path';
import EventEmitter from 'node:events';
import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';

import Parser from './parser.js';
import Protocol from './protocol.js';
import Stats from './sync/stats.js';
import Entry from './sync/entry.js';
import PushTransfer from './sync/pushtransfer.js';
import PullTransfer from './sync/pulltransfer.js';
import Connection from './connection.js';
import Stats64 from './sync/stats64.js';
import Entry64 from './sync/entry64.js';
import Utils from './utils.js';

const TEMP_PATH = '/data/local/tmp';
const DEFAULT_CHMOD = 0o644;
const DATA_MAX_LENGTH = 65536;
const debug = Utils.debug('adb:sync');

const b1m = BigInt(1000000); //1000000n in es next

export interface ENOENT extends Error {
  errno: 34;
  code: 'ENOENT';
  path: string;
}

/**
 * error code from STA2
 */
export const AdbSyncStatErrorCodeMap = {
  SUCCESS : 0,
  EACCES : 13,
  EEXIST : 17,
  EFAULT : 14,
  EFBIG : 27,
  EINTR : 4,
  EINVAL : 22,
  EIO : 5,
  EISDIR : 21,
  ELOOP : 40,
  EMFILE : 24,
  ENAMETOOLONG : 36,
  ENFILE : 23,
  ENOENT : 2,
  ENOMEM : 12,
  ENOSPC : 28,
  ENOTDIR : 20,
  EOVERFLOW : 75,
  EPERM : 1,
  EROFS : 30,
  ETXTBSY : 26,
} as const;
// export type AdbSyncStatErrorCodeNames = keyof typeof AdbSyncStatErrorCodeMap;
export type AdbSyncStatErrorCode = typeof AdbSyncStatErrorCodeMap[keyof typeof AdbSyncStatErrorCodeMap];
/**
 * enforce EventEmitter typing
 */
interface IEmissions {
  error: (data: Error) => void
}

const STREAM_READ_TIMEOUT = 10000;

export default class Sync extends EventEmitter {
  private parser: Parser;

  /**
   * get a temp file path
   * @param path filename
   * @returns full path on android devices
   */
  public static temp(path: string): string {
    return `${TEMP_PATH}/${Path.basename(path)}`;
  }

  constructor(private connection: Connection) {
    super();
    this.parser = this.connection.parser as Parser;
  }

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  /**
   * Retrieves information about the given path.
   * @param path The path.
   * @returns An [`fs.Stats`][node-fs-stats] instance. While the `stats.is*` methods are available, only the following properties are supported:
   * *   **mode** The raw mode.
   * *   **size** The file size.
   * *   **mtime** The time of last modification as a `Date`.
   */
  public async stat(path: string): Promise<Stats> {
    await this.sendCommandWithArg(Protocol.STAT, path);
    await this.parser.readCode(Protocol.STAT)
    const stat = await this.parser.readBytes(12);
    const mode = stat.readUInt32LE(0);
    const size = stat.readUInt32LE(4);
    const mtime = stat.readUInt32LE(8);
    if (mode === 0) {
      return this.enoent(path);
    } else {
      return new Stats(mode, size, mtime);
    }
  }

  public async stat64(path: string): Promise<Stats64> {
    await this.sendCommandWithArg(Protocol.STA2, path);
    await this.parser.readCode(Protocol.STA2)
    const stat = await this.parser.readBytes(68); // IQQIIIIQqqq https://daeken.svbtle.com/arbitrary-file-write-by-adb-pull
    const error = stat.readUInt32LE(0);
    const dev = stat.readBigUint64LE(4);
    const ino = stat.readBigUint64LE(12);
    const mode = stat.readUInt32LE(20);
    const nlink = BigInt(stat.readUInt32LE(24));
    const uid = BigInt(stat.readUInt32LE(28));
    const gid = BigInt(stat.readUInt32LE(32));
    const size = stat.readBigUint64LE(36);
    const atime = stat.readBigUint64LE(44) * b1m;
    const mtime = stat.readBigUint64LE(52) * b1m;
    const ctime = stat.readBigUint64LE(60) * b1m;
    if (mode === 0) {
      return this.enoent(path);
    } else {
      return new Stats64(error, dev, ino, BigInt(mode), nlink, uid, gid, size, atime, mtime, ctime);
    }
  }

  /**
   * Retrieves a list of directory entries (e.g. files) in the given path, not including the `.` and `..` entries, just like [`fs.readdir`][node-fs]. If given a non-directory path, no entries are returned.
   * 
   * @param path The path.
   * @returns An `Array` of [`fs.Stats`][node-fs-stats]-compatible instances. While the `stats.is*` methods are available, only the following properties are supported (in addition to the `name` field which contains the filename):
   *  *   **name** The filename.
   *  *   **mode** The raw mode.
   *  *   **size** The file size.
   *  *   **mtime** The time of last modification as a `Date`.
   */
  public async readdir(path: string): Promise<Array<Entry>> {
    const files: Entry[] = [];
    await this.sendCommandWithArg(Protocol.LIST, path);
    for (; ;) {
      const reply = await this.parser.readCode(Protocol.DENT, Protocol.DONE);
      if (reply === Protocol.DONE) {
        await this.parser.readBytes(16)
        return files;
      }
      const stat = await this.parser.readBytes(16);
      const mode = stat.readUInt32LE(0);
      const size = stat.readUInt32LE(4);
      const mtime = stat.readUInt32LE(8);
      const namelen = stat.readUInt32LE(12);
      const name = await this.parser.readBytes(namelen);
      const nameString = name.toString();
      // Skip '.' and '..' to match Node's fs.readdir().
      if (!(nameString === '.' || nameString === '..')) {
        files.push(new Entry(nameString, mode, size, mtime));
      }
    }
  }

  public async readdir64(path: string): Promise<Array<Entry64>> {
    const files: Entry64[] = [];
    await this.sendCommandWithArg(Protocol.LIS2, path);
    for (; ;) {
      const reply = await this.parser.readCode(Protocol.DNT2, Protocol.DONE);
      if (reply === Protocol.DONE) {
        await this.parser.readBytes(16)
        return files;
      }
      const stat = await this.parser.readBytes(72); // IQQIIIIQqqqI // https://daeken.svbtle.com/arbitrary-file-write-by-adb-pull
      const error = stat.readUInt32LE(0);
      const dev = stat.readBigUint64LE(4);
      const ino = stat.readBigUint64LE(12);
      const mode = stat.readUInt32LE(20);
      const nlink = BigInt(stat.readUInt32LE(24));
      const uid = BigInt(stat.readUInt32LE(28));
      const gid = BigInt(stat.readUInt32LE(32));
      const size = stat.readBigUint64LE(36);
      const atime = stat.readBigUint64LE(44) * b1m;
      const mtime = stat.readBigUint64LE(52) * b1m;
      const ctime = stat.readBigUint64LE(60) * b1m;
      const namelen = stat.readUInt32LE(68); // I
      const name = await this.parser.readBytes(namelen);
      const nameString = name.toString();
      // Skip '.' and '..' to match Node's fs.readdir().
      if (!(nameString === '.' || nameString === '..')) {
        files.push(new Entry64(nameString, error, dev, ino, BigInt(mode), nlink, uid, gid, size, atime, mtime, ctime));
      }
    }
  }

  /**
   * Attempts to identify `contents` and calls the appropriate `push*` method for it.
   * 
   * @param contents When `String`, treated as a local file path and forwarded to `sync.pushFile()`. Otherwise, treated as a [`Stream`][node-stream] and forwarded to `sync.pushStream()`.
   * @param path The path to push to.
   * @param mode Optional. The mode of the file. Defaults to `0644`.
   * @returns A `PushTransfer` instance. See below for details.
   */
  public async push(contents: string | Readable, path: string, mode?: number, streamName = 'stream'): Promise<PushTransfer> {
    if (typeof contents === 'string') {
      return this.pushFile(contents, path, mode);
    } else {
      return this.pushStream(contents, path, mode, streamName);
    }
  }
  /**
   * Pushes a local file to the given path. Note that the path must be writable by the ADB user (usually `shell`). When in doubt, use `'/data/local/tmp'` with an appropriate filename.
   * 
   * @param file The local file path.
   * @param path See `sync.push()` for details.
   * @param mode See `sync.push()` for details.
   * @returns See `sync.push()` for details.
   */
  public async pushFile(file: string, path: string, mode = DEFAULT_CHMOD): Promise<PushTransfer> {
    // mode || (mode = DEFAULT_CHMOD);
    try {
      const stats = await fs.promises.stat(file);
      if (stats.isDirectory())
        throw Error(`can not push directory "${file}" only files are supported for now.`);
    } catch (e) {
      throw Error(`can not read file "${file}" Err: ${JSON.stringify(e)}`);
    }
    const stream = fs.createReadStream(file);
    return this.pushStream(stream, path, mode, file);
  }

  /**
   * Pushes a [`Stream`][node-stream] to the given path. Note that the path must be writable by the ADB user (usually `shell`). When in doubt, use `'/data/local/tmp'` with an appropriate filename.
   * 
   * @param stream The readable stream.
   * @param path See `sync.push()` for details.
   * @param mode See `sync.push()` for details.
   * @returns See `sync.push()` for details.
   */
  public async pushStream(stream: Readable, path: string, mode = DEFAULT_CHMOD, streamName = 'stream'): Promise<PushTransfer> {
    mode |= Stats.S_IFREG;
    await this.sendCommandWithArg(Protocol.SEND, `${path},${mode}`);
    return this._writeData(stream, Math.floor(Date.now() / 1000), streamName);
  }

  /**
   * Pulls a file from the device as a `PullTransfer` [`Stream`][node-stream].
   * @param path The path to pull from.
   * @returns A `PullTransfer` instance. See below for details.
   */
  public async pull(path: string): Promise<PullTransfer> {
    await this.sendCommandWithArg(Protocol.RECV, `${path}`);
    return this.readData();
  }

  /**
   * Closes the Sync connection, allowing Node to quit (assuming nothing else is keeping it alive, of course).
   * @returns Returns: The sync instance.
   */
  public end(): Sync {
    this.connection.end();
    return this;
  }

  /**
   * A simple helper method for creating appropriate temporary filenames for pushing files. This is essentially the same as taking the basename of the file and appending it to `'/data/local/tmp/'`.
   * 
   * @param path The path of the file.
   * @returns An appropriate temporary file path.
   */
  public tempFile(path: string): string {
    return Sync.temp(path);
  }

  private async _writeData(stream: Readable, timeStamp: number, streamName: string): Promise<PushTransfer> {
    const transfer = new PushTransfer();
    stream.once('error', (err) => {
      throw new Error(`Source Error: ${err.message} while transfering ${streamName}`)
    });
    this.connection.once('error', (err: Error) => {
      stream.destroy(err);
      this.connection.end();
      throw new Error(`Target Error: ${err.message} while transfering ${streamName}`);
    });
    for (let i = 0; ; i++) {
      if (stream.closed)
        break;
      const readable = await Utils.waitforReadable(stream, STREAM_READ_TIMEOUT);
      if (!readable)
        break;
      let chunk: ReturnType<Readable['read']>;
      // eslint-disable-next-line no-cond-assign
      while (chunk = (stream.read(DATA_MAX_LENGTH) || stream.read())) {
        await this.sendCommandWithLength(Protocol.DATA, chunk.length);
        transfer.push(chunk.length);
        await this.connection.write(chunk);
        transfer.pop();
      }
    }
    await this.sendCommandWithLength(Protocol.DONE, timeStamp);
    try {
      await this.parser.readCode(Protocol.OKAY)
    } catch (err) {
      transfer.emit('error', err as Error);
    } finally {
      transfer.end();
    }
    return transfer;
  }

  private readData(): PullTransfer {
    const transfer = new PullTransfer();
    const readAll = async (): Promise<boolean> => {
      for (; ;) {
        const reply = await this.parser.readCode(Protocol.DATA, Protocol.DONE);
        if (reply === Protocol.DONE) {
          await this.parser.readBytes(4)
          return true;
        }
        const lengthData = await this.parser.readBytes(4)
        const length = lengthData.readUInt32LE(0);
        await this.parser.readByteFlow(length, transfer)
      }
    };

    readAll().catch(err => {
      transfer.emit('error', err as Error)
    }).finally(() => {
      return transfer.end();
    });
    return transfer;
  }

  /**
   * 
   * @param cmd 
   * @param length 
   * @returns byte write count
   */
  private sendCommandWithLength(cmd: string, length: number): Promise<number> {
    if (cmd !== Protocol.DATA) {
      debug(cmd);
    }
    const payload = Buffer.allocUnsafe(cmd.length + 4);
    payload.write(cmd, 0, cmd.length);
    payload.writeUInt32LE(length, cmd.length);
    this.parser.lastMessage = `${cmd} ${length}`;
    return this.connection.write(payload);
  }

  /**
   * 
   * @param cmd 
   * @param arg 
   * @returns byte write count
   */
  private sendCommandWithArg(cmd: string, arg: string): Promise<number> {
    this.parser.lastMessage = `${cmd} ${arg}`;
    debug(this.parser.lastMessage);
    const arglen = Buffer.byteLength(arg, 'utf-8');
    const payload = Buffer.allocUnsafe(cmd.length + 4 + arglen);
    payload.write(cmd, 0, cmd.length);
    payload.writeUInt32LE(arglen, cmd.length);
    payload.write(arg, cmd.length + 4);
    return this.connection.write(payload);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private enoent(path: string): Promise<any> {
    const err: ENOENT = new Error(`ENOENT, no such file or directory '${path}'`) as ENOENT;
    err.errno = 34;
    err.code = 'ENOENT';
    err.path = path;
    return Promise.reject(err);
  }
}
