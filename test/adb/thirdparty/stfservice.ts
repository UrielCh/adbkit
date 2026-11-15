import { expect } from 'chai';
import sinon from 'sinon';
import { PassThrough } from 'node:stream';
import type DeviceClient from '../../../src/adb/DeviceClient.js';
import STFService from '../../../src/adb/thirdparty/STFService/STFService.js';
import STFServiceBuf from '../../../src/adb/thirdparty/STFService/STFServiceBuf.js';
import { MessageTypeMap } from '../../../src/adb/thirdparty/STFService/STFServiceModel.js';
import Utils from '../../../src/adb/utils.js';

describe('STFService', () => {
  afterEach(() => sinon.restore());

  it('caches the installed APK path and detects version changes', async () => {
    const execOut = sinon.stub();
    execOut.onFirstCall().resolves('package:/data/app/stf.apk\n');
    execOut.onSecondCall().resolves('2.4.9\n');
    execOut.onThirdCall().resolves('2.3.0\n');
    execOut.onCall(3).resolves('');
    const service = new STFService({ execOut } as unknown as DeviceClient);
    expect(await service['checkVersion']('2.4.9')).to.equal('OK');
    expect(await service['checkVersion']('2.4.9')).to.equal('MISMATCH');
    expect(await service['checkVersion']('2.4.9')).to.equal('MISSING');
    expect(execOut.firstCall.args[0]).to.equal('pm path jp.co.cyberagent.stf');
    expect(execOut.callCount).to.equal(4);
    expect(execOut.secondCall.args[0]).to.include("CLASSPATH='/data/app/stf.apk'");
  });

  it('uninstalls only the STF package', async () => {
    const uninstall = sinon.stub().resolves(true);
    const execOut = sinon.stub();
    const service = new STFService({ uninstall, execOut } as unknown as DeviceClient);
    expect(await service.uninstall()).to.equal(true);
    expect(uninstall.calledOnceWithExactly('jp.co.cyberagent.stf')).to.equal(true);
    expect(execOut.called).to.equal(false);
  });

  it('formats touch commands and sends them to the minitouch connection', async () => {
    const service = new STFService({} as DeviceClient);
    const write = sinon.stub().resolves(1);
    sinon.stub(service, 'getMinitouchSocket').resolves({ write } as never);
    await service.down(12.7, 34.9, 1, 40);
    await service.moveCommit(15, 20, 0, 3);
    await service.upCommit(1);
    await service.wait(25);
    await service.commit();
    expect(write.args.map(call => call[0])).to.deep.equal(['d 1 12 34 40\n', 'm 0 15 20 3\nc\n', 'u 1\nc\n', 'w 25\n', 'c\n']);
  });

  it('starts the service with the Android-version appropriate command', async () => {
    const shell = sinon.stub().callsFake(async () => {
      const stream = new PassThrough();
      stream.end('Starting service\n');
      return stream;
    });
    const getProperties = sinon.stub().resolves({ 'ro.build.version.sdk': '25' });
    const service = new STFService({ shell, getProperties } as unknown as DeviceClient);
    await service['startService']();
    expect(shell.firstCall.args[0]).to.include('am startservice ');
    getProperties.resolves({ 'ro.build.version.sdk': '30' });
    await service['startService']();
    expect(shell.secondCall.args[0]).to.include('am start-foreground-service ');
  });
  it('encodes requests and resolves a matching protobuf response', async () => {
    const service = new STFService({} as DeviceClient);
    const proto = await STFServiceBuf.get();
    service['protoSrv'] = proto;
    const write = sinon.stub().resolves(0);
    service['servicesSocket'] = { write } as never;
    sinon.stub(Utils, 'delay').returns(new Promise(() => {}));
    const result = service.getWifiStatus();
    await new Promise<void>(resolve => setImmediate(resolve));
    const envelope = proto.readEnvelopeDelimited(write.firstCall.args[0]);
    expect(envelope.type).to.equal(MessageTypeMap.GET_WIFI_STATUS);
    expect(envelope.id).to.be.a('number');
    const responseType = proto.root.lookupType('GetWifiStatusResponse');
    const encoded = responseType.encode(responseType.create({ success: true, status: true })).finish();
    service['responseHook'][envelope.id!](encoded);
    expect((await result).status).to.equal(true);
  });

  it('rejects an unanswered service request on timeout', async () => {
    const service = new STFService({} as DeviceClient);
    service['protoSrv'] = await STFServiceBuf.get();
    service['servicesSocket'] = { write: async () => 0 } as never;
    sinon.stub(Utils, 'delay').resolves();
    try { await service.getWifiStatus(); expect.fail('expected timeout'); }
    catch (err) { expect((err as Error).message).to.equal('timeout'); }
  });

});
