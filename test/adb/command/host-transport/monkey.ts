import Stream from 'node:stream';
import { setImmediate } from "node:timers";
import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import MonkeyCommand from '../../../../src/adb/command/host-transport/monkey.js';

describe('MonkeyCommand', () => {
    it("should send 'monkey --port <port> -v'", () => {
        const conn = new MockConnection();
        const cmd = new MonkeyCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(
                Protocol.encodeData('shell:EXTERNAL_STORAGE=/data/local/tmp monkey --port 1080 -v').toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(':Monkey: foo\n');
        });
        return cmd.execute(1080);
    });
    it('should resolve with the output stream', async () => {
        const conn = new MockConnection();
        const cmd = new MonkeyCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(':Monkey: foo\n');
        });
        const stream = await cmd.execute(1080);
        stream.end();
        expect(stream).to.be.an.instanceof(Stream.Readable);
        return true;
    });
    it("should resolve after a timeout if result can't be judged from output", async () => {
        const conn = new MockConnection();
        const cmd = new MonkeyCommand(conn, 10);
        setImmediate(() => {
            return conn.getSocket().causeRead(Protocol.OKAY);
        });
        const stream = await cmd.execute(1080);
        stream.end();
        expect(stream).to.be.an.instanceof(Stream.Readable);
        return true;
    });
});
