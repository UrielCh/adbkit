import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection';
import Protocol from '../../../../src/adb/protocol';
import SyncCommand from '../../../../src/adb/command/host-transport/sync';

describe('SyncCommand', () => {
    it("should send 'sync:'", () => {
        const conn = new MockConnection();
        const cmd = new SyncCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData('sync:').toString());
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeEnd();
        });
        return cmd.execute();
    });
});
