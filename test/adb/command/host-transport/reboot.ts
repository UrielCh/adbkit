import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import RebootCommand from '../../../../src/adb/command/host-transport/reboot.js';
import Tester from './Tester.js';

const t = new Tester(RebootCommand);

describe('RebootCommand', () => {
    it("should send 'reboot:'", () => t.testTr('reboot:'));

    it("should send 'reboot:recovery'", () => t.testTr('reboot:recovery', 'recovery'));
    
    it("should send 'reboot:sideload'", () => t.testTr('reboot:sideload', 'sideload'));

    it('should send wait for the connection to end', async () => {
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
