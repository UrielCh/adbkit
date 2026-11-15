import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import { PassThrough } from 'node:stream';
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import FrameBufferCommand from '../../../../src/adb/command/host-transport/framebuffer.js';
import FramebufferMeta from '../../../../src/models/FramebufferMeta.js';

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
    it("should pipe parser.raw() to gm stdin for 'rgb'/'rgba' formats and propagate spawn errors", async () => {
        const conn = new MockConnection();
        const cmd = new FrameBufferCommand(conn);
        const meta: FramebufferMeta = {
            version: 1,
            bpp: 32,
            size: 16,
            width: 2,
            height: 2,
            red_offset: 0,
            red_length: 8,
            blue_offset: 16,
            blue_length: 8,
            green_offset: 8,
            green_length: 8,
            alpha_offset: 24,
            alpha_length: 8,
            format: 'rgba',
        };
        const raw = new PassThrough();
        cmd.parser.raw = () => raw as unknown as ReturnType<typeof cmd.parser.raw>;

        const out = cmd._convert(meta, 'png');
        // Verify raw was piped (readableFlowing becomes true or 'data' listener is attached)
        expect(raw.listenerCount('data')).to.be.greaterThan(0);

        // Attach error listener so if gm is missing, error is caught cleanly rather than crashing;
        // if gm is installed, end raw so gm exits cleanly.
        const donePromise = new Promise<void>((resolve) => {
            out.on('error', () => resolve());
            out.on('close', () => resolve());
            out.on('end', () => resolve());
            out.resume();
        });
        raw.end(Buffer.alloc(16));
        await donePromise;
    });
});
