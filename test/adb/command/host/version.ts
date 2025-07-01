import { setImmediate } from "node:timers";
import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import HostVersionCommand from '../../../../src/adb/command/host/HostVersionCommand.js';

describe('HostVersionCommand', () => {
    it("should send 'host:version'", () => {
        const conn = new MockConnection();
        const cmd = new HostVersionCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('host:version').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(Protocol.encodeData('0000'));
            return conn.getSocket().causeEnd();
        });
        return cmd.execute()
    });
    it('should resolve with version', async () => {
        const conn = new MockConnection();
        const cmd = new HostVersionCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(Protocol.encodeData((0x1234).toString(16)));
            return conn.getSocket().causeEnd();
        });
        const version = await cmd.execute()
        expect(version).to.equal(0x1234);
        return true;
    });
    it('should handle old-style version', async () => {
        const conn = new MockConnection();
        const cmd = new HostVersionCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead((0x1234).toString(16));
            return conn.getSocket().causeEnd();
        });
        const version = await cmd.execute()
        expect(version).to.equal(0x1234);
        return true;
    });
});
