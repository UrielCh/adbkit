import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection';
import Protocol from '../../../../src/adb/protocol';
import UsbCommand from '../../../../src/adb/command/host-transport/usb';

describe('UsbCommand', () => {
    it("should send 'usb:'", async () => {
        const conn = new MockConnection();
        const cmd = new UsbCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('usb:').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('restarting in USB mode\n');
            return conn.getSocket().causeEnd();
        });
        const val = await cmd.execute();
        expect(val).to.be.true;
    });
    it('should reject on unexpected reply', (done) => {
        const conn = new MockConnection();
        const cmd = new UsbCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('invalid port\n');
            return conn.getSocket().causeEnd();
        });
        
        cmd.execute().catch((err) => {
            expect(err.message).to.eql('invalid port');
            done();
        });
    });
});
