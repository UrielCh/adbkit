import Fs from 'node:fs';
import Stream from 'node:stream';
import Sinon from 'sinon';
import { use, expect, assert } from 'chai';
import simonChai from 'sinon-chai';
import Adb, { Client } from '../../src/index.js';
import Sync, { ENOENT } from '../../src/adb/sync.js';
import Stats from '../../src/adb/sync/stats.js';
import Entry from '../../src/adb/sync/entry.js';
import PushTransfer from '../../src/adb/sync/pushtransfer.js';
import PullTransfer from '../../src/adb/sync/pulltransfer.js';
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
        this.timeout(10000);
        client = Adb.createClient();
        const devices = await client.listDevices();
        deviceList = devices;
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
            sync.push(stream, 'foo');
            return expect(sync.pushStream).to.have.been.called;
        });
        it('should call pushFile when contents is a String', async () => {
            const conn = new MockConnection();
            const sync = new Sync(conn);
            // const stream = new Stream.PassThrough();
            Sinon.stub(sync, 'pushFile');
            // __filename
            sync.push(import.meta.url, 'foo');
            return expect(sync.pushFile).to.have.been.called;
        });
        // now return a promise
        // it('push > should return a PushTransfer instance', async () => {
        //     const conn = new MockConnection();
        //     const sync = new Sync(conn);
        //     const stream = new Stream.PassThrough();
        //     stream.write('AAA');
        //     const transfer = await sync.push(stream, 'foo');
        //     expect(transfer).to.be.an.instanceof(PushTransfer);
        //     const ret = transfer.cancel();
        //     console.log('cancel return ', ret);
        //     return true;
        // });
    });
    describe('pushStream(stream, path[, mode])', () => {
        // now return a promise
        // it('pushStream > should return a PushTransfer instance', async () => {
        //     const conn = new MockConnection();
        //     const sync = new Sync(conn);
        //     const stream = new Stream.PassThrough();
        //     stream.write('AAA');
        //     const transfer = await sync.pushStream(stream, 'foo');
        //     expect(transfer).to.be.an.instanceof(PushTransfer);
        //     transfer.cancel();
        //     return true;
        // });
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
            forEachSyncDevice((sync) => {
                return new Promise(async (resolve) => {
                    const transfer = await sync.pull(SURELY_NONEXISTING_PATH);
                    return transfer.on('error', resolve);
                });
            }).finally(done);
        });
        dt('should return a PullTransfer instance', (done) => {
            forEachSyncDevice(async (sync) => {
                const rval = await sync.pull(SURELY_EXISTING_FILE);
                expect(rval).to.be.an.instanceof(PullTransfer);
                return rval.cancel();
            }).finally(done);
        });
        return describe('Stream', () => {
            dt("should emit 'end' when pull is done", (done) => {
                forEachSyncDevice((sync) => {
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
            forEachSyncDevice((sync) => {
                const rval = sync.stat(SURELY_EXISTING_PATH);
                expect(rval).to.be.an.instanceof(Promise);
                return rval;
            }).finally(done);
        });
        dt('should call with an ENOENT error if the path does not exist', (done) => {
            forEachSyncDevice(async (sync) => {
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
            forEachSyncDevice(async (sync) => {
                const stats = await sync.stat(SURELY_EXISTING_PATH);
                return expect(stats).to.be.an.instanceof(Fs.Stats);
            }).finally(done);
        });
        describe('Stats', () => {
            // Fs.Stats constructor is now private  and can not be instanciated
            // it('should implement Fs.Stats', (done) => {
            //     expect(new Stats(0, 0, 0)).to.be.an.instanceof(Fs.Stats);
            //     done();
            // });
            dt('should set the `.mode` property for isFile() etc', (done) => {
                forEachSyncDevice(async (sync) => {
                    const stats = await sync.stat(SURELY_EXISTING_FILE);
                    expect(stats).to.be.an.instanceof(Fs.Stats);
                    expect(stats.mode).to.be.above(0);
                    expect(stats.isFile()).to.be.true;
                    return expect(stats.isDirectory()).to.be.false;
                }).finally(done);
            });
            dt('should set the `.size` property', (done) => {
                forEachSyncDevice(async (sync) => {
                    const stats = await sync.stat(SURELY_EXISTING_FILE);
                    expect(stats).to.be.an.instanceof(Fs.Stats);
                    expect(stats.isFile()).to.be.true;
                    return expect(stats.size).to.be.above(0);
                }).finally(done);
            });
            dt('should set the `.mtime` property', (done) => {
                forEachSyncDevice(async (sync) => {
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
                forEachSyncDevice(async (sync) => {
                    const files = await sync.readdir(SURELY_EXISTING_PATH);
                    expect(files).to.be.an('Array');
                    return files.forEach((file) => {
                        expect(file.name).to.not.be.null;
                        return expect(file).to.be.an.instanceof(Entry);
                    });
                }).finally(done);
            });
            dt('should set the Stats properties', (done) => {
                forEachSyncDevice(async (sync) => {
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
    });
});
