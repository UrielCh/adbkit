import Stream, { Transform } from 'node:stream';
import Sinon from 'sinon';
import { use, expect } from 'chai';
import sinonChai from 'sinon-chai';
import Parser from '../../src/adb/parser.ts';
import Tracker from '../../src/adb/tracker.ts';
import Protocol from '../../src/adb/protocol.ts';
import HostTrackDevicesCommand from '../../src/adb/command/host/HostTrackDevicesCommand.ts';
import Connection from '../../src/adb/connection.ts';
//import Device from '../../models/Device.ts';
import DeviceClient from '../../src/adb/DeviceClient.ts';
import Utils from '../../src/adb/utils.ts';
import { Device } from '../../src/index.ts';
use(sinonChai);

const getClient = () => null as unknown as DeviceClient;

describe('Tracker', () => {
    let writer: Transform;
    let conn: Connection;
    let cmd: HostTrackDevicesCommand;
    let tracker: Tracker;
    beforeEach(() => {
        writer = new Stream.PassThrough();
        conn = {
            parser: new Parser(writer),
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            end: () => { },
        } as Connection;
        cmd = new HostTrackDevicesCommand(conn);
        tracker = new Tracker(cmd);
    });
    it("should emit 'add' when a device is added", (done) => {
        const spy = Sinon.spy();
        tracker.on('add', spy);
        const device1: Device = { id: 'a', type: 'device', getClient };
        const device2: Device = { id: 'b', type: 'device', getClient };
        tracker.update([device1, device2]);
        expect(spy).to.have.been.calledTwice;
        expect(spy).to.have.been.calledWith(device1);
        expect(spy).to.have.been.calledWith(device2);
        done();
    });
    it("should emit 'remove' when a device is removed", (done) => {
        const spy = Sinon.spy();
        tracker.on('remove', spy);
        const device1: Device = { id: 'a', type: 'device', getClient };
        const device2: Device = { id: 'b', type: 'device', getClient };
        tracker.update([device1, device2]);
        tracker.update([device1]);
        expect(spy).to.have.been.calledOnce;
        expect(spy).to.have.been.calledWith(device2);
        done();
    });
    it("should emit 'change' when a device changes", (done) => {
        const spy = Sinon.spy();
        tracker.on('change', spy);
        const deviceOld: Device = { id: 'a', type: 'device', getClient };
        const deviceNew: Device = { id: 'a', type: 'offline', getClient };
        tracker.update([deviceOld]);
        tracker.update([deviceNew]);
        expect(spy).to.have.been.calledOnce;
        expect(spy).to.have.been.calledWith(deviceNew, deviceOld);
        done();
    });
    it("should emit 'changeSet' with all changes", (done) => {
        const spy = Sinon.spy();
        tracker.on('changeSet', spy);
        const device1: Device = { id: 'a', type: 'device', getClient };
        const device2: Device = { id: 'b', type: 'device', getClient };
        const device3: Device = { id: 'c', type: 'device', getClient };
        const device3New: Device = { id: 'c', type: 'offline', getClient };
        const device4: Device = { id: 'd', type: 'offline', getClient };
        tracker.update([device1, device2, device3]);
        tracker.update([device1, device3New, device4]);
        expect(spy).to.have.been.calledTwice;
        expect(spy).to.have.been.calledWith({
            added: [device1, device2, device3],
            changed: [],
            removed: [],
        });
        expect(spy).to.have.been.calledWith({
            added: [device4],
            changed: [device3New],
            removed: [device2],
        });
        done();
    });
    it("should emit 'error' and 'end' when connection ends", (done) => {
        tracker.on('error', () => tracker.on('end', done));
        writer.end();
    });
    it('should read devices from socket', async () => {
        const spy = Sinon.spy();
        tracker.on('changeSet', spy);
        const device1: Device = { id: 'a', type: 'device', getClient };
        const device2: Device = { id: 'b', type: 'device', getClient };
        const device3: Device = { id: 'c', type: 'device', getClient };
        const device3New: Device = { id: 'c', type: 'offline', getClient };
        const device4: Device = { id: 'd', type: 'offline', getClient };
        writer.write(
            Protocol.encodeData(`a\tdevice
b\tdevice
c\tdevice`),
        );
        writer.write(
            Protocol.encodeData(`a\tdevice
c\toffline
d\toffline`),
        );
        await Utils.delay(10)
        expect(spy).to.have.been.calledTwice;
        // expect(spy).to.have.been.calledWith({
        //     added: [device1, device2, device3],
        //     changed: [],
        //     removed: [],
        // });
        // expect(spy).to.have.been.calledWith({
        //     added: [device4],
        //     changed: [device3New],
        //     removed: [device2],
        // });
        return true;
    });
    // broken test
    // depend on bluebird
    // return describe('end()', () => {
    //     it('should close the connection', (done) => {
    //         Sinon.spy(conn.parser, 'end');
    //         tracker.on('end', () => {
    //             expect(conn.parser.end).to.have.been.calledOnce;
    //             done();
    //         });
    //         tracker.end();
    //     });
    //     it('should not cause an error to be emit', (done) => {
    //         const spy = Sinon.spy();
    //         tracker.on('error', spy);
    //         tracker.on('end', () => {
    //             expect(spy).to.not.have.been.called;
    //             done();
    //         });
    //         tracker.end();
    //     });
    // });
});
