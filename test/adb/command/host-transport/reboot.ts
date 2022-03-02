import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection';
import Protocol from '../../../../src/adb/protocol';
import RebootCommand from '../../../../src/adb/command/host-transport/reboot';

describe('RebootCommand', () => {
    it("should send 'reboot:'", () => {
        const conn = new MockConnection();
        const cmd = new RebootCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('reboot:').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        return cmd.execute();
    });
    return it('should send wait for the connection to end', async () => {
        const conn = new MockConnection();
        const cmd = new RebootCommand(conn);
        let ended = false;
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('reboot:').toString());
        });
        setImmediate(() => {
            return conn.getSocket().causeRead(Protocol.OKAY);
        });
        setImmediate(() => {
            ended = true;
            return conn.getSocket().causeEnd();
        });
        await cmd.execute();
        expect(ended).to.be.true;
    });
});
