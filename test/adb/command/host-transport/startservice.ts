import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import StartServiceCommand from '../../../../src/adb/command/host-transport/startservice.js';

describe('StartServiceCommand', () => {
    it("should succeed when 'Success' returned", () => {
        const conn = new MockConnection();
        const cmd = new StartServiceCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success');
            conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
        };
        return cmd.execute(options);
    });
    it("should fail when 'Error' returned", async () => {
        const conn = new MockConnection();
        const cmd = new StartServiceCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Error: foo\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
        };
        let caught: unknown;
        try {
            await cmd.execute(options);
        } catch (err) {
            caught = err;
        }
        expect(caught).to.be.an.instanceOf(Error);
        expect((caught as Error).message).to.equal('foo');
    });
    it("should send 'am startservice --user 0 -n <pkg>'", () => {
        const conn = new MockConnection();
        const cmd = new StartServiceCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(
                Protocol.encodeData("shell:am startservice -n 'com.dummy.component/.Main' --user 0").toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
            user: 0,
        };
        return cmd.execute(options);
    });
    it("should not send user option if not set'", () => {
        const conn = new MockConnection();
        const cmd = new StartServiceCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(
                Protocol.encodeData("shell:am startservice -n 'com.dummy.component/.Main'").toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
        };
        return cmd.execute(options);
    });
});
