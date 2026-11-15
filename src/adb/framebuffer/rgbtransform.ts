import { Buffer } from 'node:buffer';
import Assert from 'node:assert';
import { Stream, TransformCallback, TransformOptions } from 'node:stream';
import FramebufferMeta from '../../models/FramebufferMeta.js';

export default class RgbTransform extends Stream.Transform {
  private _buffer: Buffer = Buffer.from('');
  private readonly _r_pos: number;
  private readonly _g_pos: number;
  private readonly _b_pos: number;
  private readonly _a_pos: number;
  private readonly _pixel_bytes: number;

  constructor(private meta: FramebufferMeta, options?: TransformOptions) {
    super(options);
    Assert.ok(
      this.meta.bpp === 24 || this.meta.bpp === 32,
      'Only 24-bit and 32-bit raw images with 8-bits per color are supported',
    );
    this._r_pos = this.meta.red_offset / 8;
    this._g_pos = this.meta.green_offset / 8;
    this._b_pos = this.meta.blue_offset / 8;
    this._a_pos = this.meta.alpha_offset / 8;
    this._pixel_bytes = this.meta.bpp / 8;
  }

  override _transform(chunk: Buffer, encoding: string, done: TransformCallback): void {
    if (this._buffer.length) {
      this._buffer = Buffer.concat([this._buffer, chunk]);
    } else {
      this._buffer = chunk;
    }
    let sourceCursor = 0;
    let targetCursor = 0;
    const target =
      this._pixel_bytes === 3 ? this._buffer : Buffer.alloc(Math.max(4, (chunk.length / this._pixel_bytes) * 3));
    const bufferArray = this._buffer;
    while (bufferArray.length - sourceCursor >= this._pixel_bytes) {
      const r = bufferArray[sourceCursor + this._r_pos];
      const g = bufferArray[sourceCursor + this._g_pos];
      const b = bufferArray[sourceCursor + this._b_pos];
      target[targetCursor + 0] = r;
      target[targetCursor + 1] = g;
      target[targetCursor + 2] = b;
      sourceCursor += this._pixel_bytes;
      targetCursor += 3;
    }
    if (targetCursor) {
      this.push(target.slice(0, targetCursor));
      this._buffer = this._buffer.slice(sourceCursor);
    }
    done();
  }
}
