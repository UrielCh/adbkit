import Stream from 'node:stream';
import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import Parser from '../../../../src/adb/parser.js';
import LogcatCommand from '../../../../src/adb/command/host-transport/logcat.js';

describe('LogcatCommand', () => {
    it("should send 'echo && logcat -B *:I'", () => {
        const conn = new MockConnection();
        const cmd = new LogcatCommand(conn);
        conn.getSocket().on('write', (chunk: Buffer) => {
            return expect(chunk.toString()).to.equal(
                Protocol.encodeData('shell:echo && logcat -B *:I 2>/dev/null').toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        return cmd.execute();
    });
    it("should send 'echo && logcat -c && logcat -B *:I' if options.clear is set", () => {
        const conn = new MockConnection();
        const cmd = new LogcatCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(
                Protocol.encodeData('shell:echo && logcat -c 2>/dev/null && logcat -B *:I 2>/dev/null').toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        return cmd
            .execute({
                clear: true,
            })
    });
    it('should resolve with the logcat stream', async () => {
        const conn = new MockConnection();
        const cmd = new LogcatCommand(conn);
        setImmediate(() => {
            return conn.getSocket().causeRead(Protocol.OKAY);
        });
        const stream = await cmd.execute();
        stream.end();
        expect(stream).to.be.an.instanceof(Stream.Readable);
    });
    it('should perform CRLF transformation by default', async () => {
        const conn = new MockConnection();
        const cmd = new LogcatCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('\r\nfoo\r\n');
            return conn.getSocket().causeEnd();
        });
        const stream = await cmd.execute();
        const out = await new Parser(stream).readAll();
        expect(out.toString()).to.equal('foo\n');
    });
    it('should not perform CRLF transformation if not needed', async () => {
        const conn = new MockConnection();
        const cmd = new LogcatCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('\nfoo\r\n');
            return conn.getSocket().causeEnd();
        });
        const stream = await cmd.execute();
        const out = await new Parser(stream).readAll();
        expect(out.toString()).to.equal('foo\r\n');
    });
});
