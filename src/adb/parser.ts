import { Buffer } from 'node:buffer';
import { Duplex } from 'node:stream';

import Protocol from './protocol.js';
import { AdbFailError, AdbPrematureEOFError, AdbUnexpectedDataError } from './errors.js';
import { AdbError } from './errors.js';
import { BufferEncoding } from './utils.js';

/**
 * helper to read in Duplex stream
 */
export default class Parser {
  private ended = false;
  public lastMessage = '';

  constructor(public stream: Duplex) {
    if (stream.readableEnded) {
      this.ended = true;
    } else {
      stream.once('end', () => {
        this.ended = true;
      });
    }
  }

  private isEnded(): boolean {
    if (!this.ended && this.stream.readableEnded) {
      this.ended = true;
    }
    return this.ended;
  }

  /**
   * read and drop all remaining data in stream
   * @returns 
   */
  public async end(): Promise<true> {
    if (this.isEnded()) {
      return true;
    }
    const stream = this.stream;
    let tryRead: () => void;
    let errorListener: (error: Error) => void;
    let endListener: () => void;
    return new Promise<true>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.ended = true;
        resolve(true);
      };
      tryRead = () => {
        while (stream.read()) {
          // read and drop
        }
        if (this.isEnded()) {
          finish();
        }
      };
      errorListener = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      endListener = finish;
      stream.on('readable', tryRead);
      stream.on('error', errorListener);
      stream.on('end', endListener);
      tryRead();
      if (!settled) {
        stream.end();
      }
    }).finally(() => {
      stream.removeListener('readable', tryRead);
      stream.removeListener('error', errorListener);
      stream.removeListener('end', endListener);
    });
  }
  /**
   * @returns the internal Duplex
   */
  public raw(): Duplex {
    return this.stream;
  }

  public async readAll(): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const stream = this.stream;

    let tryRead: () => void;
    let errorListener: (error: Error) => void;
    let endListener: () => void;

    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.ended = true;
        resolve(Buffer.concat(chunks));
      };
      tryRead = () => {
        let chunk: Buffer;
        while ((chunk = stream.read())) {
          chunks.push(chunk);
        }
        if (this.isEnded()) {
          finish();
        }
      };
      errorListener = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      endListener = finish;
      stream.on('readable', tryRead);
      stream.on('error', errorListener);
      stream.on('end', endListener);
      tryRead();
    }).finally(() => {
      stream.removeListener('readable', tryRead);
      stream.removeListener('error', errorListener);
      stream.removeListener('end', endListener);
    });
  }

  public async readAscii(howMany: number): Promise<string> {
    const chunk = await this.readBytes(howMany);
    return chunk.toString('ascii');
  }

  /**
   * should read code or failed
   * the correct fail exception will be thow in case of error.
   * @param codes the expected 4 char code to read
   */
  public async readCode(...codes: string[]): Promise<string> {
    const reply = await this.readAscii(4);
    for (const code of codes)
      if (code === reply)
        return code;
    if (reply === 'FAIL')
      throw await this.readError();
    throw this.unexpected(reply, `${codes.join(', ')} or FAIL`);
  }

  public async readBytes(howMany: number): Promise<Buffer> {
    if (!howMany) {
      return Buffer.alloc(0);
    }
    let tryRead: () => void;
    let errorListener: (error: Error) => void;
    let endListener: () => void;
    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      tryRead = () => {
        if (settled) return;
        const chunk = this.stream.read(howMany);
        if (chunk) {
          // If the stream ends while still having unread bytes, the read call
          // will ignore the limit and just return what it's got.
          howMany -= chunk.length;
          if (howMany === 0) {
            settled = true;
            return resolve(chunk);
          }
        }
        if (this.isEnded()) {
          settled = true;
          return reject(new AdbPrematureEOFError(howMany, this.lastMessage));
        }
      };
      endListener = () => {
        this.ended = true;
        if (settled) return;
        settled = true;
        return reject(new AdbPrematureEOFError(howMany, this.lastMessage));
      };
      errorListener = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      this.stream.on('readable', tryRead);
      this.stream.on('error', errorListener);
      this.stream.on('end', endListener);
      tryRead();
    }).finally(() => {
      this.stream.removeListener('readable', tryRead);
      this.stream.removeListener('error', errorListener);
      this.stream.removeListener('end', endListener);
    });
  }

  /**
   * pipe howMany bytes to targetStream
   * @param howMany bytes to transfer
   * @param targetStream destination stream
   * @returns Promise that resolves when all bytes are transferred
   */
  public async readByteFlow(howMany: number, targetStream: Duplex): Promise<void> {
    if (!howMany) {
      return;
    }
    const stream = this.stream;
    let tryRead: () => void;
    let errorListener: (error: Error) => void;
    let endListener: () => void;
    let drainListener: () => void;
    let targetErrorListener: (error: Error) => void;
    let targetCloseListener: () => void;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let waitingForDrain = Boolean(targetStream.writableNeedDrain);

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      if (targetStream.destroyed || !targetStream.writable) {
        return fail(new Error('Target stream is not writable'));
      }

      tryRead = () => {
        if (settled || waitingForDrain) {
          return;
        }
        let chunk: Buffer;
        // Try to get the exact amount we need first. If unsuccessful, take
        // whatever is available, which will be less than the needed amount.
        while (howMany > 0 && (chunk = stream.read(howMany) || stream.read())) {
          const chunkLen = chunk.length;
          if (chunkLen > howMany) {
            const overflow = chunk.subarray(howMany);
            chunk = chunk.subarray(0, howMany);
            stream.unshift(overflow);
            howMany = 0;
          } else {
            howMany -= chunkLen;
          }
          const canContinue = targetStream.write(chunk);
          if (settled) {
            return;
          }
          if (!canContinue) {
            waitingForDrain = true;
            return;
          }
          if (howMany === 0) {
            return succeed();
          }
        }
        if (howMany === 0) {
          return succeed();
        }
        if (this.isEnded()) {
          return fail(new AdbPrematureEOFError(howMany, this.lastMessage));
        }
      };

      drainListener = () => {
        waitingForDrain = false;
        if (howMany === 0) {
          return succeed();
        }
        tryRead();
      };

      endListener = () => {
        this.ended = true;
        if (howMany > 0) {
          fail(new AdbPrematureEOFError(howMany, this.lastMessage));
        }
      };

      errorListener = (err) => fail(err);
      targetErrorListener = (err) => fail(err);
      targetCloseListener = () => {
        if (!settled) {
          fail(new Error('Target stream closed before transfer completed'));
        }
      };

      stream.on('readable', tryRead);
      stream.on('error', errorListener);
      stream.on('end', endListener);
      targetStream.on('drain', drainListener);
      targetStream.on('error', targetErrorListener);
      targetStream.on('close', targetCloseListener);
      if (!waitingForDrain) {
        tryRead();
      }
    }).finally(() => {
      stream.removeListener('readable', tryRead);
      stream.removeListener('error', errorListener);
      stream.removeListener('end', endListener);
      targetStream.removeListener('drain', drainListener);
      targetStream.removeListener('error', targetErrorListener);
      targetStream.removeListener('close', targetCloseListener);
    });
  }

  public async readError(): Promise<AdbError> {
    let error = 'unknown Error';
    try {
      error = await this.readValue('utf8');
    } catch (e) {
      // keep localy generated error
      if (e instanceof AdbFailError) {
        return e;
      } else if (e instanceof AdbPrematureEOFError) {
        return e;
      } else if (e instanceof AdbUnexpectedDataError) {
        return e;
      }
      error += ` ${e}`;
    }
    return new AdbFailError(error, this.lastMessage);
  }

  /**
   * @returns read a 4-ASCII digits length-prefixed data block
   */
  public async readValue(): Promise<Buffer>;
  public async readValue(encoding: BufferEncoding): Promise<string>;
  public async readValue(encoding?: BufferEncoding): Promise<Buffer | string> {
    const value = await this.readAscii(4);
    const length = Protocol.decodeLength(value);
    const buf = await this.readBytes(length);
    if (encoding) {
      return buf.toString(encoding);
    }
    return buf;
  }

  /**
   * read stream until a delimiter is found
   * @param code delimiter
   * @returns buffer without delimiter
   */
  public async readUntil(code: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const stream = this.stream;
    let tryRead: () => void;
    let errorListener: (error: Error) => void;
    let endListener: () => void;

    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      tryRead = () => {
        if (settled) return;
        let chunk: Buffer | null;
        while ((chunk = stream.read())) {
          const idx = chunk.indexOf(code);
          if (idx !== -1) {
            if (idx > 0) {
              chunks.push(chunk.subarray(0, idx));
            }
            const remainder = chunk.subarray(idx + 1);
            if (remainder.length > 0) {
              stream.unshift(remainder);
            }
            settled = true;
            return resolve(Buffer.concat(chunks));
          }
          chunks.push(chunk);
        }
        if (this.isEnded()) {
          settled = true;
          return reject(new AdbPrematureEOFError(1, this.lastMessage));
        }
      };
      endListener = () => {
        this.ended = true;
        if (settled) return;
        settled = true;
        return reject(new AdbPrematureEOFError(1, this.lastMessage));
      };
      errorListener = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      stream.on('readable', tryRead);
      stream.on('error', errorListener);
      stream.on('end', endListener);
      tryRead();
    }).finally(() => {
      stream.removeListener('readable', tryRead);
      stream.removeListener('error', errorListener);
      stream.removeListener('end', endListener);
    });
  }

  async searchLine(re: RegExp): Promise<RegExpExecArray> {
    for (; ;) {
      const line = await this.readLine();
      const match = re.exec(line);
      if (match) {
        return match;
      }
    }
  }

  /**
   * read socket until \r\n
   * @returns 
   */
  public async readLine(encoding?: BufferEncoding): Promise<string> {
    // read until \n
    const line = await this.readUntil(10);
    // drop tailing \r if present
    const len = line.length;
    if (line[len - 1] === 13) {
      return line.slice(0, -1).toString(encoding);
    } else {
      return line.toString(encoding);
    }
  }

  public unexpected(data: string, expected: string): AdbUnexpectedDataError {
    return new AdbUnexpectedDataError(data, expected, this.lastMessage);
  }
}
