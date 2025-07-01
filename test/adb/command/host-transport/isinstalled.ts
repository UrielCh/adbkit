import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';

import IsInstalledCommand from '../../../../src/adb/command/host-transport/isinstalled.js';

describe('IsInstalledCommand', () => {
    it("should send 'pm path <pkg>'", () => {
        const conn = new MockConnection();
        const cmd = new IsInstalledCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('shell:pm path foo 2>/dev/null').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('package:foo\r\n');
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('foo');
    });
    it('should resolve with true if package returned by command', async () => {
        const conn = new MockConnection();
        const cmd = new IsInstalledCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('package:bar\r\n');
            return conn.getSocket().causeEnd();
        });
        const found = await cmd.execute('foo');
        expect(found).to.be.true;
    });
    it('should resolve with false if no package returned', async () => {
        const conn = new MockConnection();
        const cmd = new IsInstalledCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        const found = await cmd.execute('foo');
        expect(found).to.be.false;
    });
    it('should fail if any other data is received', (done) => {
        const conn = new MockConnection();
        const cmd = new IsInstalledCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('open: Permission failed\r\n');
            return conn.getSocket().causeEnd();
        });
        cmd.execute('foo').catch((err) => {
            expect(err).to.be.an.instanceof(Error);
            done();
        });
    });
});
