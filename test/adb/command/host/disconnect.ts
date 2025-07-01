import { setImmediate } from "node:timers";
import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import HostDisconnectCommand from '../../../../src/adb/command/host/HostDisconnectCommand.js';
import Connection from '../../../../src/adb/connection.js';

describe('DisconnectCommand', () => {
    it("should send 'host:disconnect:<host>:<port>'", () => {
        const conn = new MockConnection();
        const cmd = new HostDisconnectCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(
                Protocol.encodeData('host:disconnect:192.168.2.2:5555').toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(Protocol.encodeData(''));
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('192.168.2.2', 5555);
    });
    it('should resolve with the new device id if disconnected', async () => {
        const conn = new MockConnection();
        const cmd = new HostDisconnectCommand(conn as Connection);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(Protocol.encodeData(''));
            return conn.getSocket().causeEnd();
        });
        const val = await cmd.execute('192.168.2.2', 5555);
        expect(val).to.be.equal('192.168.2.2:5555');
    });
    it('should reject with error if unable to disconnect', async () => {
        const conn = new MockConnection();
        const cmd = new HostDisconnectCommand(conn as Connection);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(Protocol.encodeData('No such device 192.168.2.2:5555'));
            return conn.getSocket().causeEnd();
        });
        try {
            return await cmd.execute('192.168.2.2', 5555);
        } catch (err) {
            expect((err as Error).message).to.eql('No such device 192.168.2.2:5555');
        }
    });
    it('should resolve with the new device id if disconnected', async () => {
        const conn = new MockConnection();
        const cmd = new HostDisconnectCommand(conn as Connection);
        setImmediate(function () {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(Protocol.encodeData('disconnected 192.168.2.2:5555'));
            return conn.getSocket().causeEnd();
        });
        
        const val = await cmd.execute('192.168.2.2', 5555)
        expect(val).to.be.equal('192.168.2.2:5555');
    }); 
});
