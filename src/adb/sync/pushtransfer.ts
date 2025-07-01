import EventEmitter from 'node:events';

/**
 * enforce EventEmitter typing
 */
interface IEmissions {
  /**
   * Emitted on error.
   */
  end: () => void
  cancel: () => void
  /**
   * **(stats)** Emitted when a chunk has been flushed to the ADB connection.
   * @param stats An object with the following stats about the transfer:
   */
  progress: (stats: { /** The number of bytes transferred so far. */ bytesTransferred: number }) => void
  /**
   * Emitted when the transfer has successfully completed.
   */
  error: (data: Error) => void
}
/**
 * A simple EventEmitter, mainly for keeping track of the progress.
 */
export default class PushTransfer extends EventEmitter {
  private stack: number[] = [];
  public stats = {
    bytesTransferred: 0,
  };

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  /**
   * Cancels the transfer by ending both the stream that is being pushed and the sync connection. This will most likely end up creating a broken file on your device. **Use at your own risk.** Also note that you must create a new sync connection if you wish to continue using the sync service.
   * @returns The pushTransfer instance.
   */
  public cancel(): boolean {
    return this.emit('cancel');
  }

  public push(byteCount: number): number {
    return this.stack.push(byteCount);
  }

  public pop(): boolean {
    const byteCount = this.stack.pop();
    if (byteCount) {
      this.stats.bytesTransferred += byteCount;
    }
    return this.emit('progress', this.stats);
  }

  private done = false;
  public end(): boolean {
    this.done = true;
    return this.emit('end');
  }

  private waitForEndPromise?: Promise<void>;
  /**
   * get end notification using Promise
   */
  public waitForEnd(): Promise<void> {
    if (!this.waitForEndPromise) {
      if (this.done) {
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
