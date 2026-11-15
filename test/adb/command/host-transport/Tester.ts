import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import Command from '../../../../src/adb/command.js';
import Connection from '../../../../src/adb/connection.js';
import { DeviceClientOptions } from '../../../../src/models/DeviceClientOptions.js';

interface ExecutableCommand<TResult, TArgs extends unknown[]> extends Command<TResult> {
    execute(...args: TArgs): Promise<TResult>;
}

interface CommandConstructor<TResult, TArgs extends unknown[]> {
    new(connection: Connection, options?: Partial<DeviceClientOptions>): ExecutableCommand<TResult, TArgs>;
}

export default class Tester<TResult = unknown, TArgs extends unknown[] = unknown[]> {
    constructor(private cmdClass: CommandConstructor<TResult, TArgs>) {
    }

    // enable su sudo next command
    private _sudo = false;

    public sudo(): this {
        this._sudo = true;
        return this;
    }

    private consumeSudo(): Partial<DeviceClientOptions> | undefined {
        if (!this._sudo) {
            return undefined;
        }
        this._sudo = false;
        return { sudo: true };
    }

    /**
     * check under the hood sent data
     * should send 'xxxxxx'
     */
    testTr(expectWrite: string, ...args: TArgs | []): Promise<TResult> {
        const conn = new MockConnection();
        const cmd = new this.cmdClass(conn, this.consumeSudo());
        if (expectWrite)
            conn.getSocket().on('write', (chunk) => {
                return expect(chunk.toString()).to.equal(Protocol.encodeData(expectWrite).toString());
            });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeEnd();
        });
        return cmd.execute(...(args as TArgs));
    }

    /**
     * check under the hood sent data
     */
    testTr2(expectWrite: string, causeRead?: string, ...args: TArgs | []): Promise<TResult> {
        const conn = new MockConnection();
        const cmd = new this.cmdClass(conn, this.consumeSudo());
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
        return cmd.execute(...(args as TArgs));
    }

    /**
     * check command parser
     */
    testPr(readData?: string | string[], ...args: TArgs | []): Promise<TResult> {
        const conn = new MockConnection();
        const cmd = new this.cmdClass(conn, this.consumeSudo());
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
        return cmd.execute(...(args as TArgs));
    }
}