import Stream from 'node:stream';
import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import LogCommand from '../../../../src/adb/command/host-transport/log.js';
import Tester from './Tester.js';
const t = new Tester(LogCommand);

describe('LogCommand', () => {
    it("should send 'log:<log>'", async () => {
        await t.testTr('log:main', 'main');
        // return a Duplex;
        return true;
    });
    it('should resolve with the log stream', async () => {
        const conn = new MockConnection();
        const cmd = new LogCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
        });
        const stream = await cmd.execute('main');
        stream.end();
        expect(stream).to.be.an.instanceof(Stream.Readable);
    });
});
