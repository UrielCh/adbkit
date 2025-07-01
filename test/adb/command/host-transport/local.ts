import Stream from 'node:stream';
import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import LocalCommand from '../../../../src/adb/command/host-transport/local.js';

describe('LocalCommand', () => {
    it("should send 'localfilesystem:<path>'", () => {
        const conn = new MockConnection();
        const cmd = new LocalCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('localfilesystem:/foo.sock').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('/foo.sock')
    });
    it("should send '<type>:<path>' if <path> prefixed with '<type>:'", async () => {
        const conn = new MockConnection();
        const cmd = new LocalCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('localabstract:/foo.sock').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        const stream = await cmd.execute('localabstract:/foo.sock');
    });
    it('should resolve with the stream', async () => {
        const conn = new MockConnection();
        const cmd = new LocalCommand(conn);
        setImmediate(() => {
            return conn.getSocket().causeRead(Protocol.OKAY);
        });
        const stream = await cmd.execute('/foo.sock');
        stream.end();
        expect(stream).to.be.an.instanceof(Stream.Readable);
    });
});
