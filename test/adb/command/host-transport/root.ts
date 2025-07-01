import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import RootCommand from '../../../../src/adb/command/host-transport/root.js';
// import Tester from './Tester.js';

// const t = new Tester(RootCommand);

describe('RootCommand', () => {
    // it("should send 'root:'", () => t.testTr('root:'));
    it("should send 'root:'", async () => {
        const conn = new MockConnection();
        const cmd = new RootCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData('root:').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('restarting adbd as root\n');
            conn.getSocket().causeEnd();
        });
        const val = await cmd.execute();
        expect(val).to.be.true;
    });
    it('should reject on unexpected reply', (done) => {
        const conn = new MockConnection();
        const cmd = new RootCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('adbd cannot run as root in production builds\n');
            conn.getSocket().causeEnd();
        });
        cmd.execute().catch((err) => {
            expect(err.message).to.eql('adbd cannot run as root in production builds');
            done();
        });
    });
});
