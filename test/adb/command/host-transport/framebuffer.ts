import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import FrameBufferCommand from '../../../../src/adb/command/host-transport/framebuffer.js';

describe('FrameBufferCommand', () => {
    it("should send 'framebuffer:'", () => {
        const conn = new MockConnection();
        const cmd = new FrameBufferCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData('framebuffer:').toString());
        });
        setImmediate(() => {
            const meta = Buffer.alloc(52);
            meta.fill(0);
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(meta);
            conn.getSocket().causeEnd();
        });
        return cmd.execute('raw');
    });
    it("should parse meta header and return it as the 'meta' property of the stream", async () => {
        const conn = new MockConnection();
        const cmd = new FrameBufferCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('framebuffer:').toString());
        });
        setImmediate(() => {
            const meta = Buffer.alloc(52);
            let offset = 0;
            meta.writeUInt32LE(1, offset);
            meta.writeUInt32LE(32, (offset += 4));
            meta.writeUInt32LE(819200, (offset += 4));
            meta.writeUInt32LE(640, (offset += 4));
            meta.writeUInt32LE(320, (offset += 4));
            meta.writeUInt32LE(0, (offset += 4));
            meta.writeUInt32LE(8, (offset += 4));
            meta.writeUInt32LE(16, (offset += 4));
            meta.writeUInt32LE(8, (offset += 4));
            meta.writeUInt32LE(8, (offset += 4));
            meta.writeUInt32LE(8, (offset += 4));
            meta.writeUInt32LE(24, (offset += 4));
            meta.writeUInt32LE(8, (offset += 4));
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead(meta);
            conn.getSocket().causeEnd();
        });
        const stream = await cmd.execute('raw');
        expect(stream).to.have.property('meta');
        expect(stream.meta).to.eql({
            version: 1,
            bpp: 32,
            size: 819200,
            width: 640,
            height: 320,
            red_offset: 0,
            red_length: 8,
            blue_offset: 16,
            blue_length: 8,
            green_offset: 8,
            green_length: 8,
            alpha_offset: 24,
            alpha_length: 8,
            format: 'rgba',
        });
    });
});
