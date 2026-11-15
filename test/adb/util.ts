import Stream from 'node:stream';
import { expect, use } from 'chai';
import PromiseDuplex from 'promise-duplex';
import simonChai from 'sinon-chai';
import Utils from '../../src/adb/utils.ts';
use(simonChai); 

describe('util', () => {
    describe('readAll(stream)', () => {
        it('should return a cancellable Bluebird Promise', (done) => {
            const stream = new Stream.PassThrough();
            const promise = Utils.readAll(stream);
            expect(promise).to.be.an.instanceOf(Promise);
            stream.end();
            done();
        });
        it('should read all remaining content until the stream ends', async () => {
            const stream = new Stream.PassThrough();
            stream.write('F');
            stream.write('O');
            stream.write('O');
            stream.end();
            const buf = await Utils.readAll(stream)
            expect(buf.length).to.equal(3);
            expect(buf.toString()).to.equal('FOO');
        });
    });

    describe('waitforReadable(stream, timeout)', () => {
        it('should return false immediately when stream has already ended', async () => {
            const stream = new Stream.PassThrough({ autoDestroy: false });
            stream.end();
            stream.read();
            await new Promise<void>((resolve) => stream.once('end', resolve));
            expect(stream.readableEnded).to.equal(true);
            expect(stream.closed).to.equal(false);
            const readable = await Utils.waitforReadable(stream, 5000);
            expect(readable).to.equal(false);
        });

        it('should resolve false on end event when autoDestroy is false', async () => {
            const stream = new Stream.PassThrough({ autoDestroy: false });
            setTimeout(() => {
                stream.end();
                stream.read();
            }, 10);
            const t0 = Date.now();
            const readable = await Utils.waitforReadable(stream, 5000);
            expect(readable).to.equal(false);
            expect(Date.now() - t0).to.be.below(1000);
        });
    });

    describe('waitforText(duplex, expected, timeout)', () => {
        it('should enforce total timeout across multiple non-matching chunks', async () => {
            const stream = new Stream.PassThrough();
            const duplex = new PromiseDuplex(stream);
            const t1 = setTimeout(() => stream.write('noise1\n'), 25);
            const t2 = setTimeout(() => stream.write('noise2\n'), 50);
            const t3 = setTimeout(() => stream.write('noise3\n'), 75);

            const start = Date.now();
            let caught: unknown;
            try {
                await Utils.waitforText(duplex, /TARGET/, 90);
            } catch (err) {
                caught = err;
            } finally {
                clearTimeout(t1);
                clearTimeout(t2);
                clearTimeout(t3);
                stream.destroy();
            }
            const elapsed = Date.now() - start;
            expect(caught).to.be.an.instanceOf(Error);
            expect((caught as Error).message).to.include('timeout waiting for');
            expect(elapsed).to.be.below(160);
        });

        it('should resolve with matching text across split chunks', async () => {
            const stream = new Stream.PassThrough();
            const duplex = new PromiseDuplex(stream);
            setTimeout(() => stream.write('hello '), 10);
            setTimeout(() => stream.write('world!'), 20);
            const match = await Utils.waitforText(duplex, /hello world!/, 500);
            expect(match).to.equal('world!');
            stream.destroy();
        });
    });
});
