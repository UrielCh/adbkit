// var MockDuplex;

import Stream from 'node:stream';

export default class MockDuplex extends Stream.Duplex {
    _read(size: number): void {
        // empty
    }

    _write(chunk: Buffer, encoding: string, callback: Function): void {
        this.emit('write', chunk, encoding, callback);
        callback(null);
    }

    causeRead(chunk: string | Buffer): void {
        if (!Buffer.isBuffer(chunk)) {
            chunk = Buffer.from(chunk);
        }
        this.push(chunk);
    }

    causeEnd(): void {
        this.push(null);
    }

    end(...args: any[]): this {
        this.causeEnd(); // In order to better emulate socket streams
        return (Stream.Duplex.prototype.end as any).apply(this, args);
    }
}
