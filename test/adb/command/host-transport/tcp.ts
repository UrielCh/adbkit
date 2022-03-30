import Stream from 'node:stream';
import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection';
import Protocol from '../../../../src/adb/protocol';
import TcpCommand from '../../../../src/adb/command/host-transport/tcp';

describe('TcpCommand', () => {
    it("should send 'tcp:<port>' when no host given", () => {
        const conn = new MockConnection();
        const cmd = new TcpCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData('tcp:8080').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeEnd();
        });
        return cmd.execute(8080);
    });
    it("should send 'tcp:<port>:<host>' when host given", () => {
        const conn = new MockConnection();
        const cmd = new TcpCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData('tcp:8080:127.0.0.1').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeEnd();
        });
        return cmd.execute(8080, '127.0.0.1');
    });
    it('should resolve with the tcp stream', async () => {
        const conn = new MockConnection();
        const cmd = new TcpCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
        });
        const stream = await cmd.execute(8080);
        stream.end();
        expect(stream).to.be.an.instanceof(Stream.Readable);
    });
});
