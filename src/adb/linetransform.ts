import { Buffer } from 'node:buffer';
import Stream, { TransformCallback, TransformOptions } from 'node:stream';

interface LineTransformOptions extends TransformOptions {
  autoDetect?: boolean;
}

export default class LineTransform extends Stream.Transform {
  private savedR?: Buffer;
  private autoDetect: boolean;
  private transformNeeded: boolean;
  private skipBytes: number;

  constructor(options: LineTransformOptions = {}) {
    super(options);
    // this.savedR = null;
    this.autoDetect = options.autoDetect || false;
    this.transformNeeded = true;
    this.skipBytes = 0;
  }

  _nullTransform(chunk: Buffer, encoding: string, done: TransformCallback): void {
    this.push(chunk);
    done();
  }

  // Sadly, the ADB shell is not very smart. It automatically converts every
  // 0x0a ('\n') it can find to 0x0d 0x0a ('\r\n'). This also applies to binary
  // content. We could get rid of this behavior by setting `stty raw`, but
  // unfortunately it's not available by default (you'd have to install busybox)
  // or something similar. On the up side, it really does do this for all line
  // feeds, so a simple transform works fine.
  override _transform(chunk: Buffer, encoding: string, done: TransformCallback): void {
    // If auto detection is enabled, check the first byte. The first two
    // bytes must be either 0x0a .. or 0x0d 0x0a. This causes a need to skip
    // either one or two bytes. The autodetection runs only once.
    if (this.autoDetect) {
      if ((chunk as unknown as Uint8Array)[0] === 0x0a) {
        this.transformNeeded = false;
        this.skipBytes = 1;
      } else {
        this.skipBytes = 2;
      }
      this.autoDetect = false;
    }
    // It's technically possible that we may receive the first two bytes
    // in two separate chunks. That's why the autodetect bytes are skipped
    // here, separately.
    if (this.skipBytes) {
      const skip = Math.min((chunk as unknown as Uint8Array).length, this.skipBytes);
      chunk = chunk.slice(skip);
      this.skipBytes -= skip;
    }
    if (!(chunk as unknown as Uint8Array).length) {
      // It's possible that skipping bytes has created an empty chunk.
      return done();
    }
    if (!this.transformNeeded) {
      // At this point all bytes that needed to be skipped should have been
      // skipped. If transform is not needed, shortcut to null transform.
      return this._nullTransform(chunk, encoding, done);
    }
    // Ok looks like we're transforming.
    let lo = 0;
    let hi = 0;
    if (this.savedR) {
      if ((chunk as unknown as Uint8Array)[0] !== 0x0a) {
        this.push(this.savedR);
      }
      this.savedR = undefined;
    }
    const last = (chunk as unknown as Uint8Array).length - 1;
    while (hi <= last) {
      if ((chunk as unknown as Uint8Array)[hi] === 0x0d) {
        if (hi === last) {
          this.savedR = chunk.slice(last);
          break; // Stop hi from incrementing, we want to skip the last byte.
        } else if ((chunk as unknown as Uint8Array)[hi + 1] === 0x0a) {
          this.push(chunk.slice(lo, hi));
          lo = hi + 1;
        }
      }
      hi += 1;
    }
    if (hi !== lo) {
      this.push(chunk.slice(lo, hi));
    }
    done();
  }

  // When the stream ends on an '\r', output it as-is (assume binary data).
  override _flush(done: TransformCallback): void {
    if (this.savedR) {
      this.push(this.savedR);
    }
    done();
  }
}
