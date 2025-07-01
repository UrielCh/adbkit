import Connection from '../../src/adb/connection.js';
import Parser from '../../src/adb/parser.js';
import MockDuplex from './duplex.js';
import MockClient from './client.js';

export default class MockConnection extends Connection {
    _socket = new MockDuplex();

    constructor() {
        super(new MockClient());
        this.parser = new Parser(this._socket);
    }

    public getSocket(): MockDuplex {
        return this._socket;
    }

    public end(): this {
        this._socket.causeEnd();
        return this;
    }

    public write(chunk: string | Uint8Array): Promise<number> {
        return new Promise((accept, reject) => {
            this._socket.write(chunk, (err) => {
                if (err) reject(err);
                else accept(chunk.length);
            });
        })
    }

    // @ts-ignore
    public on(): this {
        return this;
    }
}
