import Stream from 'stream';
import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection';
import Protocol from '../../../../src/adb/protocol';
import LogCommand from '../../../../src/adb/command/host-transport/log';
import Tester from './Tester';
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
