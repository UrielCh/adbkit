import { expect } from 'chai';
import sinon from 'sinon';
import { program } from 'commander';
import readlinePromises from 'node:readline/promises';
import Client from '../src/adb/client.js';
import DeviceClient from '../src/adb/DeviceClient.js';
import { forEachDevice, getClientDevice } from '../src/cli-common.js';
import '../src/cli-connectivity.js';
import '../src/cli-bloatware.js';

describe('CLI device handling', () => {
  afterEach(() => sinon.restore());

  it('reports no devices for the all selector', async () => {
    sinon.stub(Client.prototype, 'listDevices').resolves([]);
    for (const serials of [[], ['all'], ['*']]) {
      try {
        await getClientDevice(serials);
        expect.fail('expected no devices error');
      } catch (err) {
        expect((err as Error).message).to.equal('no Android devices found');
      }
    }
  });

  it('runs all device actions and reports failures by serial', async () => {
    const devices = [new DeviceClient({} as Client, 'offline'), new DeviceClient({} as Client, 'online')];
    const seen: string[] = [];
    try {
      await forEachDevice(devices, async device => {
        seen.push(device.serial);
        if (device.serial === 'offline') throw new Error('offline');
      });
      expect.fail('expected device failure');
    } catch (err) {
      expect((err as Error).message).to.equal('[offline] offline');
    }
    expect(seen).to.deep.equal(['offline', 'online']);
  });

  it('treats empty service output as success and reports error output', async () => {
    const device = new DeviceClient({} as Client, 'serial');
    sinon.stub(Client.prototype, 'getDevice').returns(device);
    const svc = sinon.stub(device.extra, 'setSvc').resolves('  \n');
    const log = sinon.stub(console, 'log');
    await program.parseAsync(['wifi-on', 'serial'], { from: 'user' });
    expect(log.calledWith('[serial] wifi enabled')).to.equal(true);
    svc.resolves('permission denied');
    try {
      await program.parseAsync(['wifi-off', 'serial'], { from: 'user' });
      expect.fail('expected service failure');
    } catch (err) {
      expect((err as Error).message).to.equal('[serial] permission denied');
    }
  });
  it('counts only packages successfully uninstalled after confirmation', async () => {
    const device = new DeviceClient({} as Client, 'serial');
    sinon.stub(Client.prototype, 'getDevice').returns(device);
    sinon.stub(device, 'listPackages').resolves([{ name: 'bixby.one' }, { name: 'bixby.two' }] as never);
    const uninstall = sinon.stub(device, 'uninstall');
    uninstall.onFirstCall().resolves(true);
    uninstall.onSecondCall().rejects(new Error('failure'));
    const question = sinon.stub().resolves('n');
    sinon.stub(readlinePromises, 'createInterface').returns({ question, close: () => {} } as never);
    const log = sinon.stub(console, 'log');
    await program.parseAsync(['bloatware', 'serial'], { from: 'user' });
    expect(uninstall.called).to.equal(false);
    expect(log.calledWith('0 bloatware removed')).to.equal(true);
    question.resolves('y');
    await program.parseAsync(['bloatware', 'serial'], { from: 'user' });
    expect(uninstall.callCount).to.equal(2);
    expect(log.calledWith('1 bloatware removed')).to.equal(true);
  });

});
