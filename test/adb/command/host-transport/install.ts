import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import InstallCommand from '../../../../src/adb/command/host-transport/install.js';
import Tester from './Tester.js';
const t = new Tester(InstallCommand);

describe('InstallCommand', () => {
    it("should send 'pm install -r <apk>'", () => {
        const conn = new MockConnection();
        const cmd = new InstallCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('shell:pm install -r "foo"').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\r\n');
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('foo');
    });
    it("should succeed when command responds with 'Success'", () => {
        const conn = new MockConnection();
        const cmd = new InstallCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\r\n');
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('foo');
    });
    it("should reject if command responds with 'Failure [REASON]'", (done) => {
        const conn = new MockConnection();
        const cmd = new InstallCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Failure [BAR]\r\n');
            return conn.getSocket().causeEnd();
        });
        cmd.execute('foo').catch((err) => {
            done();
        });
    });
    it("should give detailed reason in rejection's code property", (done) => {
        const conn = new MockConnection();
        const cmd = new InstallCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Failure [ALREADY_EXISTS]\r\n');
            return conn.getSocket().causeEnd();
        });
        cmd.execute('foo').catch((err) => {
            expect(err.code).to.equal('ALREADY_EXISTS');
            done();
        });
    });
    it('should ignore any other data', () => {
        const conn = new MockConnection();
        const cmd = new InstallCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('open: Permission failed\r\n');
            conn.getSocket().causeRead('Success\r\n');
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('foo');
    });
});
