import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import TcpIpCommand from '../../../../src/adb/command/host-transport/tcpip.js';

describe('TcpIpCommand', () => {
    it("should send 'tcp:<port>'", () => {
        const conn = new MockConnection();
        const cmd = new TcpIpCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData('tcpip:5555').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('restarting in TCP mode port: 5555\n');
            conn.getSocket().causeEnd();
        });
        return cmd.execute(5555)
    });
    it('should resolve with the port', async () => {
        const conn = new MockConnection();
        const cmd = new TcpIpCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('restarting in TCP mode port: 5555\n');
            conn.getSocket().causeEnd();
        });
        const port = await cmd.execute(5555);
        expect(port).to.equal(5555);
    });
    it('should reject on unexpected reply', (done) => {
        const conn = new MockConnection();
        const cmd = new TcpIpCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('not sure what this could be\n');
            conn.getSocket().causeEnd();
        });
        cmd.execute(5555).catch((err) => {
            expect(err.message).to.eql('not sure what this could be');
            done();
        });
    });
});
