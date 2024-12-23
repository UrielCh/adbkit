import Stats64 from './stats64';

export default class Entry64 extends Stats64 {
  constructor(public name: string, error: number, dev: bigint, ino: bigint,
    mode: bigint, nlink: bigint, uid: bigint, gid: bigint, size: bigint,
    atimeNs: bigint, mtimeNs: bigint, ctimeNs: bigint) {
    super(error, dev, ino, mode, nlink, uid, gid, size, atimeNs, mtimeNs, ctimeNs);
  }

  public override toString(): string {
    let out = '';
    
    if (this.isDirectory()) {
      out += 'd';
    } else if (this.isSymbolicLink()) {
      out += 'l';
    } else if (this.isBlockDevice()) {
      out += 'd';
    } else if (this.isFile()) {
      out += '-';
    } else if (this.isCharacterDevice()) {
      out += 'c';
    } else if (this.isFIFO()) {
      out += 'p';
    } else if (this.isSocket()) {
      out += 's';
    } else {
      out += '?';
    }
    const mode = Number(this.mode);
    out += (mode & 256) ? 'r':'-'
    out += (mode & 128) ? 'w':'-'
    out += (mode & 64) ? 'x':'-'
    out += (mode & 32) ? 'r':'-'
    out += (mode & 16) ? 'w':'-'
    out += (mode & 8) ? 'x':'-'
    out += (mode & 4) ? 'r':'-'
    out += (mode & 2) ? 'w':'-'
    out += (mode & 1) ? 'x':'-'
    out += ' '
    out += this.gid.toString().padStart(5, ' ');
    out += ' '
    out += this.uid.toString().padStart(5, ' ');
    out += ' '
    out += this.size.toString().padStart(10, ' ');
    out += ' ';
    out += this.ctime.toISOString().substring(0, 10);
    out += ' ';
    out += this.name;
    out += ' ';
    out = out.padEnd(60, ' ');
    return out;
  }
}
