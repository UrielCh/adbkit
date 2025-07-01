import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import SyncCommand from '../../../../src/adb/command/host-transport/sync.js';

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
