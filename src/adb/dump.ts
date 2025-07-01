import fs from 'node:fs';
import { Buffer } from 'node:buffer';

let func: (chunk: Buffer) => Buffer;

if (process.env.ADBKIT_DUMP) {
  const out = fs.createWriteStream('adbkit.dump');
  func = (chunk: Buffer): Buffer => {
    out.write(chunk);
    return chunk;
  };
} else {
  func = (chunk: Buffer): Buffer => chunk;
}

export default func;
