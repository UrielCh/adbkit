import { setImmediate } from "node:timers";
import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import { WaitForDeviceCommand } from '../../../../src/adb/command/host-serial/index.js';
import Connection from '../../../../src/adb/connection.js';

describe('WaitForDeviceCommand', () => {
    it("should send 'host-serial:<serial>:wait-for-any-device'", () => {
        const conn = new MockConnection();
        const cmd = new WaitForDeviceCommand(conn as any as Connection);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('host-serial:abba:wait-for-any-device').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('abba');
    });
    it('should resolve with id when the device is connected', async () => {
        const conn = new MockConnection();
        const cmd = new WaitForDeviceCommand(conn as any as Connection);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        const id = await cmd.execute('abba')
        expect(id).to.equal('abba');
        return true;
    });
    it('should reject with error if unable to connect', async () => {
        const conn = new MockConnection();
        const cmd = new WaitForDeviceCommand(conn as any as Connection);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(Protocol.FAIL);
            conn.getSocket().causeRead(Protocol.encodeData('not sure how this might happen'));
            return conn.getSocket().causeEnd();
        });
        try {
            return await cmd.execute('abba');
        } catch (err) {
            expect((err as Error).message).to.contain('not sure how this might happen');
        }
    });
});
