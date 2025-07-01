import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import RemountCommand from '../../../../src/adb/command/host-transport/remount.js';

describe('RemountCommand', () => {
    it("should send 'remount:'", () => {
        const conn = new MockConnection();
        const cmd = new RemountCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData('remount:').toString());
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeEnd();
        });
        return cmd.execute();
    });
});
