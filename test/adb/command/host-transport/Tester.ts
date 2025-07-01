import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import Command from '../../../../src/adb/command.js';
import Connection from '../../../../src/adb/connection.js';

interface CommandConstructor<T extends Command<U>, U> {
    new(connection: Connection): T;
}

/**
 * check under the hood sent data
 */
// function test(cmdClass: CommandConstructor<any, any>, data: {write?: string | string[], read?: string | string[]}, ...args: string[]) {
//    const conn = new MockConnection();
//    const cmd = new cmdClass(conn);
//    const write = data.write ? (typeof data.write === 'string' || data.write instanceof String) ? [data.write as string]: data.write as string[]: [];
//    const read = data.read ? (typeof data.write === 'string' || data.read instanceof String) ? [data.read as string]: data.read as string[]: [];
//    if (expectWrite)
//        conn.getSocket().on('write', (chunk) => {
//            return expect(chunk.toString()).to.equal(Protocol.encodeData(expectWrite).toString());
//        });
//    setImmediate(() => {
//        conn.getSocket().causeRead(Protocol.OKAY);
//        conn.getSocket().causeEnd();
//    });
//    return cmd.execute(...args);
//}

export default class Tester {
    constructor(private cmdClass: CommandConstructor<any, any>) {
    }

    // enable su sudo next command
    private _sudo = false;

    public sudo(): this {
        this._sudo = true;
        return this;
    }

    /**
     * check under the hood sent data
     * should send 'xxxxxx'
     */
    testTr(expectWrite: string, ...args: string[]): Promise<any> {
        const conn = new MockConnection();
        const cmd = new this.cmdClass(conn);
        if (this.sudo()) {
            cmd.sudo = true;
            this._sudo = false;
        }
        if (expectWrite)
            conn.getSocket().on('write', (chunk) => {
                return expect(chunk.toString()).to.equal(Protocol.encodeData(expectWrite).toString());
            });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeEnd();
        });
        return cmd.execute(...args);
    }

    /**
     * check under the hood sent data
     */
    testTr2(expectWrite: string, causeRead?: string, ...args: string[]): Promise<any> {
        const conn = new MockConnection();
        const cmd = new this.cmdClass(conn);
        if (this.sudo()) {
            cmd.sudo = true;
            this._sudo = false;
        }
        if (expectWrite)
            conn.getSocket().on('write', (chunk) => {
                return expect(chunk.toString()).to.equal(Protocol.encodeData(expectWrite).toString());
            });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            if (causeRead)
                conn.getSocket().causeRead(causeRead);
            conn.getSocket().causeEnd();
        });
        return cmd.execute(...args);
    }

    /**
     * check command parser
     */
    testPr(readData?: string | string[], ...args: string[]): Promise<any> {
        const conn = new MockConnection();
        const cmd = new this.cmdClass(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            if (readData) {
                if (typeof readData === 'string' || readData instanceof String) {
                    conn.getSocket().causeRead(readData as string);
                } else for (const rd of readData) {
                    conn.getSocket().causeRead(rd);
                }
            }
            conn.getSocket().causeEnd();
        });
        return cmd.execute(...args);
    }
}