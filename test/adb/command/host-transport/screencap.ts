import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import Parser from '../../../../src/adb/parser.js';
import ScreencapCommand from '../../../../src/adb/command/host-transport/screencap.js';

describe('ScreencapCommand', () => {
    it("should send 'screencap -p'", () => {
        const conn = new MockConnection();
        const cmd = new ScreencapCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(
                Protocol.encodeData('shell:echo && screencap -p 2>/dev/null').toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('\r\nlegit image');
            conn.getSocket().causeEnd();
        });
        return cmd.execute()
    });
    it('should resolve with the PNG stream', async () => {
        const conn = new MockConnection();
        const cmd = new ScreencapCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('\r\nlegit image');
            conn.getSocket().causeEnd();
        });
        const stream = await cmd
            .execute();
        const out = await new Parser(stream).readAll();
        expect(out.toString()).to.equal('legit image');
    });
    it('should reject if command not supported', (done) => {
        const conn = new MockConnection();
        const cmd = new ScreencapCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeEnd();
        });
        cmd.execute().catch(() => {
            done();
        });
    });
    it('should perform CRLF transformation by default', async () => {
        const conn = new MockConnection();
        const cmd = new ScreencapCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('\r\nfoo\r\n');
            conn.getSocket().causeEnd();
        });
        const stream = await cmd
            .execute();
        const out = await new Parser(stream).readAll();
        expect(out.toString()).to.equal('foo\n');
    });
    it('should not perform CRLF transformation if not needed', async () => {
        const conn = new MockConnection();
        const cmd = new ScreencapCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('\nfoo\r\n');
            conn.getSocket().causeEnd();
        });
        const stream = await cmd
            .execute();
        const out = await new Parser(stream).readAll();
        expect(out.toString()).to.equal('foo\r\n');
    });
});
