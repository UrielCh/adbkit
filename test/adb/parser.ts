import Stream from 'node:stream';
import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
import Parser from '../../src/adb/parser.js';
import { AdbFailError, AdbPrematureEOFError, AdbUnexpectedDataError } from '../../src/adb/errors.js';
import Utils from '../../src/adb/utils.js';
use(simonChai);

describe('Parser', () => {
    describe('end()', () => {
        it('should end the stream and consume all remaining data', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('F');
            stream.write('O');
            stream.write('O');
            return await parser.end();
        });
    });
    describe('readAll()', () => {
        it('should read all remaining content until the stream ends', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const p = parser.readAll()
            stream.write('F');
            stream.write('O');
            stream.write('O');
            stream.end();
            const buf = await p;
            expect(buf.length).to.equal(3);
            expect(buf.toString()).to.equal('FOO');
            return true;
        });
        it("should resolve with an empty Buffer if the stream has already ended and there's nothing more to read", async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const p = parser.readAll();
            stream.end();
            const buf = await p;
            expect(buf.length).to.equal(0);
            return true;
        });
    });
    describe('readBytes(howMany)', () => {
        it('should read as many bytes as requested', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const p = parser.readBytes(4);
            stream.write('OKAYFAIL');
            const buf = await p;
            expect(buf.length).to.equal(4);
            expect(buf.toString()).to.equal('OKAY');
            const buf2 = await parser.readBytes(2);
            expect(buf2).to.have.length(2);
            expect(buf2.toString()).to.equal('FA');
            return true;
        });
        it('should wait for enough data to appear', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const p = parser.readBytes(5);
            await Utils.delay(50);
            stream.write('BYTES');
            const buf = await p;
            expect(buf.toString()).to.equal('BYTES');
            return true;
        });
        it('should keep data waiting even when nothing has been requested', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('FOO');
            await Utils.delay(50);
            const buf = await parser.readBytes(2);
            expect(buf.length).to.equal(2);
            expect(buf.toString()).to.equal('FO');
            return true;
        });

        it('should reject with AdbPrematureEOFError if stream ends before enough bytes can be read', (done) => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('F');
            const p = parser.readBytes(10)
            stream.end();
            p.catch(err => {
                expect(err).to.be.an.instanceOf(AdbPrematureEOFError);
                expect(err as AdbPrematureEOFError).to.be.an.instanceOf(AdbPrematureEOFError);
                done();
            })
        });
    });
    describe('readByteFlow(maxHowMany, targetStream)', () => {
        it('should read as many bytes as requested', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const target = new Stream.PassThrough();
            stream.write('OKAYFAIL');
            await parser.readByteFlow(4, target);
            expect(target.read()).to.eql(Buffer.from('OKAY'));
            await parser.readByteFlow(2, target);
            expect(target.read()).to.eql(Buffer.from('FA'));
        });
        it('should progress with new/partial chunk until maxHowMany', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const target = new Stream.PassThrough();
            stream.write(Buffer.from('P'));
            stream.write(Buffer.from('I'));
            stream.write(Buffer.from('ES'));
            stream.write(Buffer.from('R'));
            await parser.readByteFlow(3, target);
            expect(target.read()).to.eql(Buffer.from('PIE'));
        });
        it('should pause reading on targetStream backpressure and resume on drain', async () => {
            const source = new Stream.PassThrough({ highWaterMark: 16 });
            const parser = new Parser(source);
            let writeCount = 0;
            let releaseDrain!: () => void;
            const chunks: Buffer[] = [];
            const target = new Stream.Duplex({
                highWaterMark: 8,
                write(chunk: Buffer, _encoding, callback) {
                    writeCount++;
                    chunks.push(chunk);
                    if (writeCount === 1) {
                        // Hold back the first write callback so target.write() returns false (highWaterMark=8)
                        releaseDrain = () => callback();
                    } else {
                        callback();
                    }
                },
                read() {},
            });

            // Push 32 bytes in 8-byte chunks
            source.write(Buffer.alloc(8, 'a'));
            source.write(Buffer.alloc(8, 'b'));
            source.write(Buffer.alloc(8, 'c'));
            source.write(Buffer.alloc(8, 'd'));

            let resolved = false;
            const flowPromise = parser.readByteFlow(32, target).then(() => {
                resolved = true;
            });

            await Utils.delay(20);
            // Backpressure must have paused after the first write returned false
            expect(writeCount).to.equal(1);
            expect(resolved).to.equal(false);

            releaseDrain();
            await flowPromise;
            expect(resolved).to.equal(true);
            expect(Buffer.concat(chunks)).to.eql(
                Buffer.concat([
                    Buffer.alloc(8, 'a'),
                    Buffer.alloc(8, 'b'),
                    Buffer.alloc(8, 'c'),
                    Buffer.alloc(8, 'd'),
                ]),
            );
        });
        it('should wait for drain when the final write triggers backpressure', async () => {
            const source = new Stream.PassThrough();
            const parser = new Parser(source);
            let drained = false;
            let finishWrite!: () => void;
            const target = new Stream.Duplex({
                highWaterMark: 4,
                write(_chunk: Buffer, _encoding, callback) {
                    finishWrite = () => {
                        drained = true;
                        callback();
                    };
                },
                read() {},
            });

            source.write(Buffer.alloc(8, 'x'));
            let resolved = false;
            const flowPromise = parser.readByteFlow(8, target).then(() => {
                resolved = true;
            });

            await Utils.delay(20);
            expect(resolved).to.equal(false);
            expect(drained).to.equal(false);

            finishWrite();
            await flowPromise;
            expect(drained).to.equal(true);
            expect(resolved).to.equal(true);
        });
        it('should reject if targetStream closes while waiting for drain', async () => {
            const source = new Stream.PassThrough();
            const parser = new Parser(source);
            const target = new Stream.Duplex({
                highWaterMark: 4,
                write(_chunk: Buffer, _encoding, _callback) {
                    // never invoke callback so target stays under backpressure
                },
                read() {},
            });

            source.write(Buffer.alloc(16, 'y'));
            const flowPromise = parser.readByteFlow(16, target);
            await Utils.delay(10);
            target.destroy();

            let caught: unknown;
            try {
                await flowPromise;
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.an.instanceOf(Error);
        });
    });
    describe('readAscii(howMany)', () => {
        it('should read as many ascii characters as requested 1', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const p = parser.readAscii(4);
            stream.write('OKAYFAIL');
            const str = await p;
            expect(str.length).to.equal(4);
            expect(str).to.equal('OKAY');
            return true;
        });
        it('should read as many ascii characters as requested 2', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const p = parser.readAscii(4);
            stream.write('OKAYFAIL');
            stream.end();
            const str = await p;
            expect(str.length).to.equal(4);
            expect(str).to.equal('OKAY');
            return true;
        });
        it('should reject with AdbPrematureEOFError if stream ends before enough bytes can be read', (done) => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('FOO');
            parser.readAscii(7).catch(err => {
                expect(err).to.be.an.instanceOf(AdbPrematureEOFError);
                done();
            });
            stream.end();
        });
    });
    describe('readValue()', () => {
        it('should read a protocol value as a Buffer', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('0004001f');
            const value = await parser.readValue()
            expect(value).to.be.an.instanceOf(Buffer);
            expect(value).to.have.length(4);
            expect(value.toString()).to.equal('001f');
        });
        it('should return an empty value', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const p = parser.readValue()
            stream.write('0000');
            const value = await p;
            expect(value).to.be.an.instanceOf(Buffer);
            expect(value).to.have.length(0);
        });
        it('should reject with AdbPrematureEOFError if stream ends before the value can be read', (done) => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            void parser.readValue().catch(err => {
                expect(err).to.be.an.instanceOf(AdbPrematureEOFError);
                expect(err as AdbPrematureEOFError).to.be.an.instanceOf(AdbPrematureEOFError);
                done();
            });
            stream.write('00ffabc');
            stream.end();
        });
    });
    describe('readError()', () => {
        it('should reject with Parser.FailError using the value', (done) => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            void parser.readError().then(err => {
                expect(err).to.be.an.instanceOf(AdbFailError);
                done();
            })
            stream.write('000cepic failure');
        });

        it('should reject with AdbPrematureEOFError if stream ends before the error can be read', (done) => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            void parser.readError().then(err => {
                expect(err).to.be.an.instanceOf(AdbPrematureEOFError);
                done();
            });
            stream.write('000cepic')
            stream.end();
        });
    });
    describe('searchLine(re)', () => {
        it('should return the re.exec match of the matching line', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('foo bar\nzip zap\npip pop\n');
            const line = await parser.searchLine(/za(p)/)
            expect(line[0]).to.equal('zap');
            expect(line[1]).to.equal('p');
            expect(line.input).to.equal('zip zap');
            return true;
        });
        it('should reject with Parser.AdbPrematureEOFError if stream ends before a line is found', (done) => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            void parser.searchLine(/nope/).catch(err => {
                expect(err).to.be.an.instanceOf(AdbPrematureEOFError);
                done();
            })
            stream.write('foo bar');
            stream.end();
        });
    });
    describe('readLine()', () => {
        it('should skip a line terminated by \\n', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('foo bar\nzip zap\npip pop');
            await parser.readLine()
            const buf = await parser.readBytes(7)
            expect(buf.toString()).to.equal('zip zap');
            return true
        });
        it('should return skipped line', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('foo bar\nzip zap\npip pop');
            const buf = await parser.readLine()
            expect(buf).to.equal('foo bar');
        });
        it('should strip trailing \\r', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('foo bar\r\n');
            const buf = await parser.readLine()
            expect(buf).to.equal('foo bar');
            return true;
        });
        it('should reject with AdbPrematureEOFError if stream ends before a line is found', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('foo bar');
            stream.end();
            try {
                await parser.readLine()
                throw Error('should throw AdbPrematureEOFError');
            } catch (err) {
                expect(err).to.be.an.instanceOf(AdbPrematureEOFError);
            }
        });
    });
    describe('readUntil(code)', () => {
        it('should return any characters before given value', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('foo bar\nzip zap\npip pop');
            const buf = await parser.readUntil('p'.charCodeAt(0))
            expect(buf.toString()).to.equal('foo bar\nzi');
        });
        it('should reject with Parser.AdbPrematureEOFError if stream ends before a line is found', (done) => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            parser.readUntil('z'.charCodeAt(0)).catch(err => {
                expect(err).to.be.an.instanceOf(AdbPrematureEOFError);
                done();
            })
            stream.write('ho ho');
            stream.end();
        });
        it('should preserve unread remainder via unshift across multiple calls', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('alpha:beta:gamma');
            stream.end();
            const first = await parser.readUntil(':'.charCodeAt(0));
            const second = await parser.readUntil(':'.charCodeAt(0));
            const rest = await parser.readAll();
            expect(first.toString()).to.equal('alpha');
            expect(second.toString()).to.equal('beta');
            expect(rest.toString()).to.equal('gamma');
        });
        it('should handle delimiters at offset 0 and spanning multiple chunks', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.write('\nhello ');
            stream.write('world');
            stream.write('\ntail');
            const empty = await parser.readUntil(10);
            const line = await parser.readUntil(10);
            const tail = await parser.readBytes(4);
            expect(empty.length).to.equal(0);
            expect(line.toString()).to.equal('hello world');
            expect(tail.toString()).to.equal('tail');
        });
    });
    describe('already-ended stream handling', () => {
        it('should not hang on readBytes/readAll/readUntil/end when stream ended after Parser construction', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            stream.resume();
            stream.end();
            await Utils.delay(10);

            expect(await parser.readAll()).to.have.length(0);
            expect(await parser.end()).to.equal(true);
            let eofBytes: unknown;
            try {
                await parser.readBytes(1);
            } catch (err) {
                eofBytes = err;
            }
            expect(eofBytes).to.be.an.instanceOf(AdbPrematureEOFError);

            let eofUntil: unknown;
            try {
                await parser.readUntil(10);
            } catch (err) {
                eofUntil = err;
            }
            expect(eofUntil).to.be.an.instanceOf(AdbPrematureEOFError);
        });
        it('should not hang when stream.readableEnded is already true before Parser construction', async () => {
            const stream = new Stream.PassThrough();
            stream.resume();
            stream.end();
            await Utils.delay(10);
            expect(stream.readableEnded).to.equal(true);

            const parser = new Parser(stream);
            expect(await parser.readAll()).to.have.length(0);
            expect(await parser.end()).to.equal(true);
            let caught: unknown;
            try {
                await parser.readBytes(4);
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.an.instanceOf(AdbPrematureEOFError);
        });
    });
    describe('raw()', () => {
        it('should return the resumed raw stream', (done) => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const raw = parser.raw();
            expect(raw).to.equal(stream);
            raw.on('data', () => {
                done();
            });
            raw.write('foo');
        });
    });
    return describe('unexpected(data, expected)', () => {
        it('should reject with AdbUnexpectedDataError', async () => {
            const stream = new Stream.PassThrough();
            const parser = new Parser(stream);
            const e = parser.unexpected('foo', "'bar' or end of stream");
            const err = e as AdbUnexpectedDataError;
            expect(err).to.be.an.instanceOf(AdbUnexpectedDataError);
            expect(err.message).to.equal("Unexpected 'foo', was expecting 'bar' or end of stream lastMessage:");
            expect(err.unexpected).to.equal('foo');
            expect(err.expected).to.equal("'bar' or end of stream");
        });
    });
});
