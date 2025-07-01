import { Buffer } from 'node:buffer';
import { Stream } from 'node:stream';
import { BufferEncoding } from '../utils.js';

/**
 * `PullTransfer` is a [`Stream`][node-stream]. Use [`fs.createWriteStream()`][node-fs] to pipe the stream to a file if necessary.
 */
export default class PullTransfer extends Stream.PassThrough {
  public stats = {
    bytesTransferred: 0,
  };

  /**
   * Cancels the transfer by ending the connection. Can be useful for reading endless streams of data, such as `/dev/urandom` or `/dev/zero`, perhaps for benchmarking use. Note that you must create a new sync connection if you wish to continue using the sync service.
   * @returns The pullTransfer instance.
   */
  public cancel(): boolean {
    return this.emit('cancel');
  }

  override write(
    chunk: Buffer,
    encoding?: BufferEncoding | typeof callback,
    callback?: (error: Error | null | undefined) => void,
  ): boolean {
    this.stats.bytesTransferred += (chunk as unknown as Uint8Array).length;
    this.emit('progress', this.stats);
    if (typeof encoding === 'function') {
      return super.write(chunk, encoding);
    }
    return super.write(chunk, encoding, callback);
  }

  promiseWrite(
    chunk: Buffer,
    encoding?: BufferEncoding
  ): Promise<void> {
    this.stats.bytesTransferred += (chunk as unknown as Uint8Array).length;
    this.emit('progress', this.stats);
    return new Promise<void>((accept, reject) => {
      super.write(chunk, encoding, (err) => {
        if (err) reject(err);
        else accept();
      });
    })
  }

  private waitForEndPromise?: Promise<void>;
  /**
   * get end notification using Promise
   */
  public waitForEnd(): Promise<void> {
    if (!this.waitForEndPromise) {
      if (this.closed) {
        this.waitForEndPromise = Promise.resolve();
      } else {
        this.waitForEndPromise = new Promise<void>((resolve, reject) => {
          const unReg = () => {
            this.off('end', onEnd);
            this.off('error', onError);
          }
          const onError = (e: Error) => { unReg(); reject(e); };
          const onEnd = () => (unReg(), resolve());
          this.on('end', onEnd);
          this.on('error', onError);
        })
      }
    }
    return this.waitForEndPromise;
  }
}
