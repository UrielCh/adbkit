import { expect } from 'chai';
import sinon from 'sinon';
import { PassThrough } from 'node:stream';
import prebuilds from '@u4/minicap-prebuilt';
import type DeviceClient from '../../../src/adb/DeviceClient.js';
import Minicap from '../../../src/adb/thirdparty/minicap/Minicap.js';

describe('Minicap', () => {
  afterEach(() => sinon.restore());

  it('uploads missing binaries, reads the header and emits a JPEG frame', async () => {
    sinon.stub(prebuilds, 'getMinicapBin').returns('package.json');
    sinon.stub(prebuilds, 'getMinicapSO').returns('package.json');
    const server = new PassThrough();
    server.write('JpgEncoder ready');
    const video = new PassThrough();
    const header = Buffer.alloc(24);
    header[0] = 1; header[1] = 24;
    header.writeUInt32LE(123, 2);
    header.writeUInt32LE(1080, 6); header.writeUInt32LE(1920, 10);
    header.writeUInt32LE(540, 14); header.writeUInt32LE(960, 18);
    header[22] = 1; header[23] = 5;
    const frame = Buffer.from([0xff, 0xd8, 0x11, 0x22]);
    const size = Buffer.alloc(4); size.writeUInt32LE(frame.length);
    video.write(Buffer.concat([header, size, frame]));
    const push = sinon.stub().resolves({ waitForEnd: async () => {} });
    const execOut = sinon.stub().resolves('');
    const client = {
      serial: 'serial', getProperties: async () => ({ 'ro.product.cpu.abi': 'x86', 'ro.build.version.sdk': '30' }),
      stat: async () => { throw new Error('missing'); }, push,
      getPs: async () => [{ NAME: 'minicap', PID: 42 }, { NAME: 'other', PID: 1 }], execOut,
      shell: async () => server, openLocal: async () => video,
    } as unknown as DeviceClient;
    const minicap = new Minicap(client, { dimention: '1080x1920@540x960/0' });
    const frames: Buffer[] = [];
    minicap.on('data', data => { frames.push(data); minicap.stop(); });
    await minicap.start();
    await minicap.firstFrame;
    expect(await Promise.all([minicap.version, minicap.pid, minicap.width, minicap.height, minicap.orientation, minicap.QuickDumb, minicap.QuickTear]))
      .to.deep.equal([1, 123, 540, 960, 1, true, true]);
    expect(frames).to.deep.equal([frame]);
    expect(push.callCount).to.equal(2);
    expect(execOut.calledOnceWithExactly('kill 42')).to.equal(true);
  });

  it('reports missing prebuilt binaries before contacting the device', async () => {
    sinon.stub(prebuilds, 'getMinicapBin').returns(null);
    const client = { getProperties: async () => ({ 'ro.product.cpu.abi': 'x86', 'ro.build.version.sdk': '30' }) } as unknown as DeviceClient;
    try {
      await new Minicap(client).start();
      expect.fail('expected missing binary failure');
    } catch (err) {
      expect((err as Error).message).to.include('minicap not found');
    }
  });
});
