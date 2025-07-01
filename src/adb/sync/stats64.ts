import Stats from './stats.js';
import fs from 'node:fs';

const b1k = BigInt(1000);

export default class Stats64 implements fs.BigIntStats {
  isFile(): boolean {
    return !!(Number(this.mode) & Stats.S_IFREG);
  }
  isDirectory(): boolean {
    return !!(Number(this.mode) & Stats.S_IFDIR);
  }
  isBlockDevice(): boolean {
    return !!(Number(this.mode) & Stats.S_IFBLK);
  }
  isCharacterDevice(): boolean {
    return !!(Number(this.mode) & Stats.S_IFCHR);
  }
  isSymbolicLink(): boolean {
    return !!(Number(this.mode) & Stats.S_IFLNK);
  }
  isFIFO(): boolean {
    return !!(Number(this.mode) & Stats.S_IFIFO);
  }
  isSocket(): boolean {
    return !!(Number(this.mode) & Stats.S_IFSOCK);
  }

  get atimeMs(): bigint {
    return this.atimeNs / b1k;
  }
  get mtimeMs(): bigint {
    return this.mtimeNs / b1k;
  }
  get ctimeMs(): bigint {
    return this.ctimeNs / b1k;
  }
  get birthtimeMs(): bigint {
    return this.birthtimeMs / b1k;
  }

  rdev = BigInt(0);
  blksize = BigInt(0);
  blocks = BigInt(0);

  get atime(): Date {
    return new Date(Number(this.atimeMs))
  }

  get mtime(): Date {
    return new Date(Number(this.mtimeMs))
  }

  get ctime(): Date {
    return new Date(Number(this.ctimeMs))
  }

  get birthtimeNs(): bigint {
    return this.ctimeNs;
  }
  get birthtime(): Date {
    return this.ctime;
  }

  constructor(
    public readonly error: number,
    public readonly dev: bigint,
    public readonly ino: bigint,
    public readonly mode: bigint,
    public readonly nlink: bigint,
    public readonly uid: bigint,
    public readonly gid: bigint,
    public readonly size: bigint,
    public readonly atimeNs: bigint,
    public readonly mtimeNs: bigint,
    public readonly ctimeNs: bigint) { }
}
