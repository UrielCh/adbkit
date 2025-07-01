import { Buffer } from 'node:buffer';
import Parser from './parser.js';
import Auth from './auth.js';
import ExtendedPublicKey from '../models/ExtendedPublicKey.js';
import { Duplex, Readable } from 'node:stream';
import PromiseDuplex from 'promise-duplex';
import Debug from 'debug';
import PromiseReadable from 'promise-readable';

export type CancellablePromise<T> = Promise<T> & { cancel: () => void };

/**
 * Missing from Deno ?
 */
export type BufferEncoding = 
"ascii"
| "utf8"
| "utf-8"
| "utf16le"
| "utf-16le"
| "ucs2"
| "ucs-2"
| "base64"
| "base64url"
| "latin1"
| "binary"
| "hex"


export default class Utils {
  /**
   * concat buffer to fix deno typing errors.
   */
  public static concatBuffer(buffs: Buffer[]): Buffer {
    return Buffer.concat(buffs as unknown as Uint8Array[]);
  }
  /**
   * Takes a [`Stream`][node-stream] and reads everything it outputs until the stream ends. Then it resolves with the collected output. Convenient with `client.shell()`.
   * 
   * @param stream The [`Stream`][node-stream] to read.
   * @returns All the output as a [`Buffer`][node-buffer]. Use `output.toString('utf-8')` to get a readable string from it.
   */
  public static readAll(stream: Duplex): Promise<Buffer> {
    return new Parser(stream).readAll();
  }
  /**
   * Parses an Android-formatted mincrypt public key (e.g. `~/.android/adbkey.pub`).
   * 
   * @param keyString The key String or [`Buffer`][node-buffer] to parse. Not a filename.
   * @returns The key as a [forge.pki](https://github.com/digitalbazaar/forge#rsa) public key. You may need [node-forge](https://github.com/digitalbazaar/forge) for complicated operations.
   */
  public static parsePublicKey(keyString: string): Promise<ExtendedPublicKey> {
    return Auth.parsePublicKey(keyString);
  }

  /**
   * A delay promise
   * 
   * @param ms time to wait im ms
   * @returns void
   */
  public static delay(ms: number): CancellablePromise<void> {
    let timeout: null | ReturnType<typeof setTimeout> = null;
    const promise = new Promise<void>((resolve) => {
      timeout = setTimeout(() => {
        timeout = null;
        resolve();
      }, ms);
    }) as CancellablePromise<void>;
    promise.cancel = () => { if (timeout) clearTimeout(timeout); timeout = null; };
    return promise;
  }

  /**
   * Promise waiter for a Duplex to be readable
   * 
   * @param duplex a vanilla Duplex of a PromiseDuplex
   * @param timeout do not wait more than timeout
   * @returns is the true is duplex is readable
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public static async waitforReadable(duplex?: Duplex | PromiseDuplex<Duplex> | Readable | PromiseReadable<Readable>, timeout = 0, _debugCtxt = ''): Promise<boolean> {
    // let t0 = Date.now();
    /**
     * prechecks
     */
    if (!duplex)
      throw Error('can not waitforReadable on a null / undefined duplex');
    const stream: Duplex | Readable = (duplex instanceof Duplex || duplex instanceof Readable) ? duplex : duplex.stream;
    if (stream.closed)
      throw Error('can not waitforReadable on a closed duplex');
    // short-cut
    if (stream.readableLength > 0)
      return true;
    /**
     * readable is true by default
     */
    let readable = true;

    /**
     * handle close event
     */
    let onClose: (() => void) = () => { /* dummy */ };
    const waitClose = new Promise<void>((resolveAsClosed) => {
      onClose = resolveAsClosed;
      stream.on('close', onClose);
    })

    /**
     * Handle readable event
     * overwrite theResolve
     */
    let theResolve: (() => void) = () => { /* dummy */ };
    const waitRead = new Promise<void>((resolveAsReadable) => {
      theResolve = resolveAsReadable;
      stream.on('readable', theResolve)
    });

    const promises = [waitRead, waitClose];
    /**
     * Handle timeout event
     */
    let timeOut: CancellablePromise<void> | null = null;
    if (timeout) {
      timeOut = Utils.delay(timeout);
      promises.push(timeOut.then(() => { readable = false }));
    }
    /**
     * single Promise race call
     */
    await Promise.race(promises);
    /**
     * clean unused events
     */
    stream.off('readable', theResolve)
    stream.off('close', onClose);
    if (timeOut)
      timeOut.cancel();
    // t0 = Date.now() - t0;
    // console.log(`waitforReadable return after ${t0}ms`, readable, _debugCtxt);
    return readable;
  }

  /**
   * Wait for a spesific text in the Duplex
   * all text will be concatened in a single string to dean with segments.
   * 
   * @param duplex 
   * @param expected regexp to match
   * @returns matched text
   */
  public static async waitforText(duplex: PromiseDuplex<Duplex>, expected: RegExp, timeout = 10000): Promise<string> {
    let allText = '';
    const t0 = Date.now();
    let nextTimeout = timeout;
    for (; ;) {
      await this.waitforReadable(duplex, timeout);
      const buf = await duplex.read();
      if (buf) {
        const text = buf.toString();
        allText += text;
        if (expected.test(allText))
          return text;
        // console.log('RCV Non matching DATA:', text);
      }
      if (timeout) {
        const timeSpend = Date.now() - t0;
        if (nextTimeout <= 0)
          throw Error(`timeout waiting for ${expected}, receved: ${allText}`);
        nextTimeout = timeout - timeSpend;
      }
    }
  }

  public static debug(name: string) {
    const debug = Debug(name);
    debug.log = console.log.bind(console);
    return debug;
  }
}
