import Fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Stream from 'node:stream';
import Sinon from 'sinon';
import { use, expect, assert } from 'chai';
import simonChai from 'sinon-chai';
import Adb, { Client } from '../../src/index.js';
import Sync, { ENOENT } from '../../src/adb/sync.js';
import Stats from '../../src/adb/sync/stats.js';
import Stats64 from '../../src/adb/sync/stats64.js';
import Protocol from '../../src/adb/protocol.js';
import Entry from '../../src/adb/sync/entry.js';
import PushTransfer from '../../src/adb/sync/pushtransfer.js';
import PullTransfer from '../../src/adb/sync/pulltransfer.js';
import Utils from '../../src/adb/utils.js';
import MockConnection from '../mock/connection.js';
import Device from '../../src/models/Device.js';
use(simonChai);

// This test suite is a bit special in that it requires a connected Android
// device (or many devices). All will be tested.
describe('Sync', () => {
    // By default, skip tests that require a device.
    let dt = xit;
    if (process.env.RUN_DEVICE_TESTS) {
        dt = it;
    }
    const SURELY_EXISTING_FILE = '/system/build.prop';
    const SURELY_EXISTING_PATH = '/';
    const SURELY_NONEXISTING_PATH = '/non-existing-path';
    const SURELY_WRITABLE_FILE = '/data/local/tmp/_sync.test';
    let client!: Client;
    let deviceList: Device[] | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forEachSyncDevice = (iterator: (sync: Sync) => any): Promise<any> => {
        assert(deviceList && deviceList.length > 0, 'At least one connected Android device is required');
        const promises = deviceList!.map(async (device) => {
            const sync = await client
                .getDevice(device.id)
                .syncService();
            expect(sync).to.be.an.instanceof(Sync);
            try {
                return await iterator(sync);
            } finally {
                sync.end();
            }
        });
        return Promise.all(promises);
    };
    before(async function () {
        if (!process.env.RUN_DEVICE_TESTS) {
            return;
        }
        this.timeout(10000);
        client = Adb.createClient();
        const devices = await client.listDevices();
        deviceList = devices;
    });
    afterEach(() => {
        Sinon.restore();
    });
    describe('end()', () => {
        it('should end the sync connection', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            Sinon.stub(conn, 'end');
            sync.end();
            return expect(conn.end).to.have.been.called;
        });
    });
    describe('push(contents, path[, mode])', () => {
        it('should call pushStream when contents is a Stream', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const stream = new Stream.PassThrough();
            Sinon.stub(sync, 'pushStream');
            await sync.push(stream, 'foo');
            return expect(sync.pushStream).to.have.been.called;
        });
        it('should call pushFile when contents is a String', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            Sinon.stub(sync, 'pushFile');
            await sync.push(import.meta.url, 'foo');
            return expect(sync.pushFile).to.have.been.called;
        });
    });
    describe('pushFile(file, path[, mode])', () => {
        it('should preserve error code and cause when stat fails (e.g. ENOENT)', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const missingPath = path.join(os.tmpdir(), `adbkit-missing-${Date.now()}-${Math.random()}`);
            let caught: unknown;
            try {
                await sync.pushFile(missingPath, '/data/local/tmp/out');
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.an.instanceOf(Error);
            const err = caught as Error & { code?: string; cause?: NodeJS.ErrnoException };
            expect(err.code).to.equal('ENOENT');
            expect(err.cause).to.be.an.instanceOf(Error);
            expect(err.cause?.code).to.equal('ENOENT');
            expect(err.message).to.include('can not read file');
            expect(err.message).to.not.include('Err: {}');
        });
        it('should throw directory error without masking it as unreadable file', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const tmpDir = Fs.mkdtempSync(path.join(os.tmpdir(), 'adbkit-pushdir-'));
            try {
                let caught: unknown;
                try {
                    await sync.pushFile(tmpDir, '/data/local/tmp/out');
                } catch (err) {
                    caught = err;
                }
                expect(caught).to.be.an.instanceOf(Error);
                const err = caught as Error & { code?: string };
                expect(err.message).to.include('can not push directory');
                expect(err.message).to.not.include('can not read file');
                expect(err.code).to.equal('EISDIR');
            } finally {
                Fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });
    describe('pushStream(stream, path[, mode])', () => {
        it('should return PushTransfer immediately and emit progress events asynchronously', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const stream = new Stream.PassThrough();
            const progress: number[] = [];

            conn.getSocket().on('write', (chunk: Buffer) => {
                if (chunk.subarray(0, 4).toString() === Protocol.DONE) {
                    conn.getSocket().causeRead(Protocol.OKAY);
                    conn.getSocket().causeRead(Buffer.alloc(4));
                }
            });

            const transfer = await sync.pushStream(stream, 'foo');
            expect(transfer).to.be.an.instanceof(PushTransfer);
            transfer.on('progress', (stats) => {
                progress.push(stats.bytesTransferred);
            });

            stream.write('hello');
            stream.end();
            await transfer.waitForEnd();
            expect(progress).to.deep.equal([5]);
        });
        it('should emit timeout error and not send DONE when slow stream times out before ending', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const stream = new Stream.PassThrough();
            const writtenCommands: string[] = [];

            conn.getSocket().on('write', (chunk: Buffer) => {
                if (chunk.length >= 4) {
                    writtenCommands.push(chunk.subarray(0, 4).toString());
                }
            });

            Sinon.stub(Utils, 'waitforReadable').resolves(false);

            const transfer = await sync.pushStream(stream, 'foo');
            const err = await new Promise<Error>((resolve) => {
                transfer.once('error', resolve);
            });
            await transfer.waitForEnd();

            expect(err.message).to.include('timed out');
            expect(writtenCommands).to.not.include(Protocol.DONE);
            expect(stream.destroyed).to.equal(true);
        });
        it('should complete promptly on readableEnded when autoDestroy is false', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const stream = new Stream.PassThrough({ autoDestroy: false });
            const progress: number[] = [];

            conn.getSocket().on('write', (chunk: Buffer) => {
                if (chunk.subarray(0, 4).toString() === Protocol.DONE) {
                    conn.getSocket().causeRead(Protocol.OKAY);
                    conn.getSocket().causeRead(Buffer.alloc(4));
                }
            });

            const transfer = await sync.pushStream(stream, 'foo');
            transfer.on('progress', (stats) => {
                progress.push(stats.bytesTransferred);
            });

            stream.write('abc');
            stream.end();
            await transfer.waitForEnd();
            expect(stream.readableEnded).to.equal(true);
            expect(stream.closed).to.equal(false);
            expect(progress).to.deep.equal([3]);
        });
        it('should emit error on PushTransfer when source stream errors', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const stream = new Stream.PassThrough();
            const transfer = await sync.pushStream(stream, 'foo');

            const errorPromise = new Promise<Error>((resolve) => {
                transfer.once('error', resolve);
            });
            stream.destroy(new Error('read boom'));
            const err = await errorPromise;
            expect(err.message).to.include('Source Error: read boom');
        });
        it('should emit error on PushTransfer when connection errors', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const stream = new Stream.PassThrough();
            const transfer = await sync.pushStream(stream, 'foo');

            const errorPromise = new Promise<Error>((resolve) => {
                transfer.once('error', resolve);
            });
            conn.emit('error', new Error('write boom'));
            const err = await errorPromise;
            expect(err.message).to.include('Target Error: write boom');
        });
        it('should abort pushStream, destroy source stream, and end connection when cancel() is called', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const stream = new Stream.PassThrough();
            let connEnded = false;
            const origEnd = conn.end.bind(conn);
            conn.end = () => {
                connEnded = true;
                return origEnd();
            };

            const transfer = await sync.pushStream(stream, 'foo');
            transfer.cancel();
            await transfer.waitForEnd();

            expect(connEnded).to.equal(true);
            expect(stream.destroyed).to.equal(true);
        });
        it('should chunk payloads larger than DATA_MAX_LENGTH (65536 bytes)', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const dataSizes: number[] = [];
            const payload = Buffer.alloc(70000, 0x41);
            const stream = Stream.Readable.from([payload]);
            const progress: number[] = [];

            conn.getSocket().on('write', (chunk: Buffer) => {
                const tag = chunk.subarray(0, 4).toString();
                if (tag === Protocol.DATA) {
                    dataSizes.push(chunk.readUInt32LE(4));
                } else if (tag === Protocol.DONE) {
                    conn.getSocket().causeRead(Protocol.OKAY);
                    conn.getSocket().causeRead(Buffer.alloc(4));
                }
            });

            const transfer = await sync.pushStream(stream, 'big.bin');
            transfer.on('progress', (stats) => {
                progress.push(stats.bytesTransferred);
            });
            await transfer.waitForEnd();

            expect(dataSizes).to.deep.equal([65536, 4464]);
            expect(progress).to.deep.equal([65536, 70000]);
        });
        it('should abort promptly when cancelled while waiting for readable stream', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            const stream = new Stream.PassThrough();

            const transfer = await sync.pushStream(stream, 'slow.bin');
            await new Promise((resolve) => setTimeout(resolve, 10));
            transfer.cancel();
            await transfer.waitForEnd();

            expect(stream.destroyed).to.equal(true);
        });
        it('should abort pull and end connection when PullTransfer.cancel() is called', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            let connEnded = false;
            const origEnd = conn.end.bind(conn);
            conn.end = () => {
                connEnded = true;
                return origEnd();
            };

            const transfer = await sync.pull('/dev/zero');
            transfer.resume();
            transfer.cancel();
            await transfer.waitForEnd();

            expect(connEnded).to.equal(true);
        });
        dt('should be able to push >65536 byte chunks without error', async () => {
            await forEachSyncDevice((sync) => {
                return new Promise<void>(async (resolve, reject) => {
                    const stream = new Stream.PassThrough();
                    const content = Buffer.alloc(1000000);
                    const transfer = await sync.pushStream(stream, SURELY_WRITABLE_FILE);
                    transfer.on('error', reject);
                    transfer.on('end', resolve);
                    stream.write(content);
                    return stream.end();
                });
            })
            return true;
        });
    });
    describe('pull(path)', () => {
        dt('should retrieve the same content pushStream() pushed', async () => {
            await forEachSyncDevice((sync) => {
                return new Promise<void>(async (resolve, reject) => {
                    const stream = new Stream.PassThrough();
                    const content = 'ABCDEFGHI' + Date.now();
                    const transfer = await sync.pushStream(stream, SURELY_WRITABLE_FILE);
                    expect(transfer).to.be.an.instanceof(PushTransfer);
                    transfer.on('error', reject);
                    transfer.on('end', async () => {
                        const transfer = await sync.pull(SURELY_WRITABLE_FILE);
                        expect(transfer).to.be.an.instanceof(PullTransfer);
                        transfer.on('error', reject);
                        return transfer.on('readable', () => {
                            let chunk: Buffer;
                            if ((chunk = transfer.read())) {
                                expect(chunk).to.not.be.null;
                                expect(chunk.toString()).to.equal(content);
                                resolve();
                            }
                        });
                    });
                    stream.write(content);
                    return stream.end();
                });
            })
            return true;
        });
        dt('should emit error for non-existing files', (done) => {
            void forEachSyncDevice((sync) => {
                return new Promise(async (resolve) => {
                    const transfer = await sync.pull(SURELY_NONEXISTING_PATH);
                    return transfer.on('error', resolve);
                });
            }).finally(done);
        });
        dt('should return a PullTransfer instance', (done) => {
            void forEachSyncDevice(async (sync) => {
                const rval = await sync.pull(SURELY_EXISTING_FILE);
                expect(rval).to.be.an.instanceof(PullTransfer);
                return rval.cancel();
            }).finally(done);
        });
        return describe('Stream', () => {
            dt("should emit 'end' when pull is done", (done) => {
                void forEachSyncDevice((sync) => {
                    return new Promise(async (resolve, reject) => {
                        const transfer = await sync.pull(SURELY_EXISTING_FILE);
                        transfer.on('error', reject);
                        transfer.on('end', resolve);
                        return transfer.resume();
                    });
                }).finally(done);
            });
        });
    });
    return describe('stat(path)', () => {
        dt('should return a Promise', (done) => {
            void forEachSyncDevice((sync) => {
                const rval = sync.stat(SURELY_EXISTING_PATH);
                expect(rval).to.be.an.instanceof(Promise);
                return rval;
            }).finally(done);
        });
        dt('should call with an ENOENT error if the path does not exist', (done) => {
            void forEachSyncDevice(async (sync) => {
                try {
                    await sync.stat(SURELY_NONEXISTING_PATH);
                    throw new Error('Should not reach success branch');
                } catch (e) {
                    const err = e as ENOENT;
                    expect(err).to.be.an.instanceof(Error);
                    expect(err.code).to.equal('ENOENT');
                    expect(err.errno).to.equal(34);
                    return expect(err.path).to.equal(SURELY_NONEXISTING_PATH);
                }
            }).finally(done);
        });
        dt('should call with an fs.Stats instance for an existing path', (done) => {
            void forEachSyncDevice(async (sync) => {
                const stats = await sync.stat(SURELY_EXISTING_PATH);
                return expect(stats).to.be.an.instanceof(Fs.Stats);
            }).finally(done);
        });
        describe('Stats', () => {
            dt('should set the `.mode` property for isFile() etc', (done) => {
                void forEachSyncDevice(async (sync) => {
                    const stats = await sync.stat(SURELY_EXISTING_FILE);
                    expect(stats).to.be.an.instanceof(Fs.Stats);
                    expect(stats.mode).to.be.above(0);
                    expect(stats.isFile()).to.be.true;
                    return expect(stats.isDirectory()).to.be.false;
                }).finally(done);
            });
            dt('should set the `.size` property', (done) => {
                void forEachSyncDevice(async (sync) => {
                    const stats = await sync.stat(SURELY_EXISTING_FILE);
                    expect(stats).to.be.an.instanceof(Fs.Stats);
                    expect(stats.isFile()).to.be.true;
                    return expect(stats.size).to.be.above(0);
                }).finally(done);
            });
            dt('should set the `.mtime` property', (done) => {
                void forEachSyncDevice(async (sync) => {
                    const stats = await sync.stat(SURELY_EXISTING_FILE);
                    expect(stats).to.be.an.instanceof(Fs.Stats);
                    return expect(stats.mtime).to.be.an.instanceof(Date);
                }).finally(done);
            });
        });
        return describe('Entry', () => {
            it('should implement Stats', (done) => {
                expect(new Entry('foo', 0, 0, 0)).to.be.an.instanceof(Stats);
                done();
            });
            dt('should set the `.name` property', (done) => {
                void forEachSyncDevice(async (sync) => {
                    const files = await sync.readdir(SURELY_EXISTING_PATH);
                    expect(files).to.be.an('Array');
                    return files.forEach((file) => {
                        expect(file.name).to.not.be.null;
                        return expect(file).to.be.an.instanceof(Entry);
                    });
                }).finally(done);
            });
            dt('should set the Stats properties', (done) => {
                void forEachSyncDevice(async (sync) => {
                    const files = await sync.readdir(SURELY_EXISTING_PATH);
                    expect(files).to.be.an('Array');
                    return files.forEach((file) => {
                        expect(file.mode).to.not.be.null;
                        expect(file.size).to.not.be.null;
                        return expect(file.mtime).to.not.be.null;
                    });
                }).finally(done);
            });
        });
        describe('Stats64', () => {
            it('should compute birthtimeMs from birthtimeNs without infinite recursion', () => {
                const stats = new Stats64(
                    0,
                    1n,
                    2n,
                    BigInt(Stats.S_IFREG | 0o644),
                    1n,
                    0n,
                    0n,
                    123n,
                    1_000_000n,
                    2_000_000n,
                    3_000_000n,
                );
                expect(stats.birthtimeMs).to.equal(3_000n);
                expect(stats.birthtime).to.be.an.instanceof(Date);
            });
        });
    });
});
