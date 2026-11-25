import { expect } from 'chai';
import fs from 'node:fs';
import type http from 'node:http';
import sinon from 'sinon';
import Client from '../../src/adb/client.js';
import DeviceClient from '../../src/adb/DeviceClient.js';
import {
  extractManifestAppInfo,
  parseResourcesTable,
} from '../../tasks/apkMeta.js';
import {
  createAppHiderServer,
  extractDeviceAbis,
  filterPackages,
  hidePackage,
  isUsbBusyError,
  loadDevicePackages,
  parseCliArgs,
  renderWebPage,
  unhidePackage,
  uninstallPackage,
  type AdbSession,
  type AppEntry,
} from '../../tasks/hideApps.js';

describe('tasks/hideApps', () => {
  afterEach(() => sinon.restore());

  it('parses CLI options and positional serial', () => {
    expect(parseCliArgs([])).to.deep.equal({
      uiHost: '127.0.0.1',
      uiPort: 3333,
      filter: 'all',
      method: 'auto',
      listOnly: false,
      help: false,
    });

    expect(parseCliArgs([
      '--connect', '192.168.1.50:5555',
      '--port', '5038',
      '--ui-port', '4444',
      '--backend', 'native',
      '--method', 'disable',
      '--launcher',
      '--list',
      'ABC123',
    ])).to.deep.equal({
      connect: '192.168.1.50:5555',
      port: 5038,
      uiHost: '127.0.0.1',
      uiPort: 4444,
      backend: 'native',
      method: 'disable',
      filter: 'launcher',
      listOnly: true,
      help: false,
      serial: 'ABC123',
    });
  });

  it('rejects invalid CLI options', () => {
    expect(() => parseCliArgs(['--port', 'abc'])).to.throw('Invalid value for --port');
    expect(() => parseCliArgs(['--ui-port', 'abc'])).to.throw('Invalid value for --ui-port');
    expect(() => parseCliArgs(['--method', 'bogus'])).to.throw('Invalid --method value');
    expect(() => parseCliArgs(['--unknown'])).to.throw('Unknown option');
  });

  it('loads and classifies enabled, disabled, and hidden packages including APK paths', async () => {
    const device = new DeviceClient({} as Client, 'serial-1');
    const getPackages = sinon.stub(device, 'getPackages');
    getPackages.withArgs('-f', '-u').resolves([
      '/data/app/~~abc==/com.user.app-xyz==/base.apk=com.user.app',
      '/system/app/Disabled/Disabled.apk=com.sys.disabled',
      '/system/app/Hidden/Hidden.apk=com.sys.hidden',
    ]);
    getPackages.withArgs('-e').resolves(['com.user.app']);
    getPackages.withArgs('-d').resolves(['com.sys.disabled']);
    getPackages.withArgs('-3').resolves(['com.user.app']);
    getPackages.withArgs('-s').resolves(['com.sys.disabled', 'com.sys.hidden']);
    sinon.stub(device, 'execOut')
      .withArgs([
        'cmd',
        'package',
        'query-activities',
        '--components',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.LAUNCHER',
      ], 'utf8')
      .resolves('com.user.app/.MainActivity\n');

    const apps = await loadDevicePackages(device);
    expect(apps).to.deep.equal([
      { name: 'com.sys.disabled', state: 'disabled', kind: 'system', apkPath: '/system/app/Disabled/Disabled.apk' },
      { name: 'com.sys.hidden', state: 'hidden', kind: 'system', apkPath: '/system/app/Hidden/Hidden.apk' },
      { name: 'com.user.app', state: 'enabled', kind: 'user', inLauncher: true, apkPath: '/data/app/~~abc==/com.user.app-xyz==/base.apk' },
    ]);
  });

  it('filters packages by category, launcher visibility, state, and search query against name or label', () => {
    const apps: AppEntry[] = [
      { name: 'com.facebook.katana', label: 'Facebook', state: 'enabled', kind: 'user', inLauncher: true },
      { name: 'com.samsung.bixby', label: 'Bixby Voice', state: 'disabled', kind: 'system' },
      { name: 'com.example.hidden', label: 'Secret Tool', state: 'hidden', kind: 'user' },
    ];

    expect(filterPackages(apps, 'launcher', '').map(a => a.name)).to.deep.equal([
      'com.facebook.katana',
    ]);
    expect(filterPackages(apps, 'user', '').map(a => a.name)).to.deep.equal([
      'com.facebook.katana',
      'com.example.hidden',
    ]);
    expect(filterPackages(apps, 'inactive', '').map(a => a.name)).to.deep.equal([
      'com.samsung.bixby',
      'com.example.hidden',
    ]);
    expect(filterPackages(apps, 'all', 'BIXBY').map(a => a.name)).to.deep.equal([
      'com.samsung.bixby',
    ]);
    expect(filterPackages(apps, 'all', 'secret').map(a => a.name)).to.deep.equal([
      'com.example.hidden',
    ]);
  });

  it('hides with pm hide and falls back to pm disable-user in auto mode on SecurityException', async () => {
    const device = new DeviceClient({} as Client, 'serial-1');
    const execOut = sinon.stub(device, 'execOut');

    execOut.withArgs(['pm', 'hide', '--user', '0', 'com.example.app'], 'utf8')
      .resolves('Package com.example.app new hidden state: true\n');
    const hiddenRes = await hidePackage(device, 'com.example.app', 'auto');
    expect(hiddenRes.state).to.equal('hidden');
    expect(hiddenRes.methodUsed).to.equal('pm hide');

    execOut.withArgs(['pm', 'hide', '--user', '0', 'com.example.fallback'], 'utf8')
      .resolves('Error: java.lang.SecurityException: Neither user 2000 nor current process has android.permission.MANAGE_USERS.\n');
    execOut.withArgs(['pm', 'disable-user', '--user', '0', 'com.example.fallback'], 'utf8')
      .resolves('Package com.example.fallback new state: disabled-user\n');

    const fallbackRes = await hidePackage(device, 'com.example.fallback', 'auto');
    expect(fallbackRes.state).to.equal('disabled');
    expect(fallbackRes.methodUsed).to.equal('pm disable-user');

    execOut.withArgs(['pm', 'hide', '--user', '0', 'com.google.android.youtube'], 'utf8')
      .resolves('Error: java.lang.SecurityException: MANAGE_USERS\n');
    execOut.withArgs(['pm', 'disable-user', '--user', '0', 'com.google.android.youtube'], 'utf8')
      .resolves('Exception occurred while executing \'disable-user\': java.lang.SecurityException: Cannot disable system packages.');
    execOut.withArgs(['pm', 'uninstall', '-k', '--user', '0', 'com.google.android.youtube'], 'utf8')
      .resolves('Success\n');

    const systemRes = await hidePackage(device, 'com.google.android.youtube', 'auto');
    expect(systemRes.state).to.equal('hidden');
    expect(systemRes.methodUsed).to.equal('pm uninstall -k --user 0');

    try {
      await hidePackage(device, 'com.example.fallback', 'hide');
      expect.fail('expected pm hide failure');
    } catch (err) {
      expect((err as Error).message).to.include('SecurityException');
    }
  });

  it('unhides disabled and hidden packages cleanly', async () => {
    const device = new DeviceClient({} as Client, 'serial-1');
    const execOut = sinon.stub(device, 'execOut');

    execOut.withArgs(['pm', 'enable', '--user', '0', 'com.example.disabled'], 'utf8')
      .resolves('Package com.example.disabled new state: enabled\n');
    const enableRes = await unhidePackage(device, 'com.example.disabled', 'disabled', 'auto');
    expect(enableRes.state).to.equal('enabled');
    expect(enableRes.methodUsed).to.equal('pm enable');

    execOut.withArgs(['pm', 'unhide', '--user', '0', 'com.example.hidden'], 'utf8')
      .resolves('Error: java.lang.SecurityException: MANAGE_USERS\n');
    execOut.withArgs(['cmd', 'package', 'install-existing', '--user', '0', 'com.example.hidden'], 'utf8')
      .resolves('Package com.example.hidden installed for user: 0\n');
    execOut.withArgs(['pm', 'enable', '--user', '0', 'com.example.hidden'], 'utf8')
      .resolves('Package com.example.hidden new state: enabled\n');

    const restoreRes = await unhidePackage(device, 'com.example.hidden', 'hidden', 'auto');
    expect(restoreRes.state).to.equal('enabled');
    expect(restoreRes.methodUsed).to.equal('cmd package install-existing');
  });

  it('tries full pm uninstall first and falls back to pm uninstall --user 0 for system apps', async () => {
    const device = new DeviceClient({} as Client, 'serial-1');
    const execOut = sinon.stub(device, 'execOut');

    execOut.withArgs(['pm', 'uninstall', 'com.user.removable'], 'utf8').resolves('Success\n');
    const userRes = await uninstallPackage(device, 'com.user.removable');
    expect(userRes).to.include({ removed: true, methodUsed: 'pm uninstall' });

    execOut.withArgs(['pm', 'uninstall', 'com.sys.bloat'], 'utf8').resolves('Failure [DELETE_FAILED_INTERNAL_ERROR]\n');
    execOut.withArgs(['pm', 'uninstall', '--user', '0', 'com.sys.bloat'], 'utf8').resolves('Success\n');
    const sysRes = await uninstallPackage(device, 'com.sys.bloat');
    expect(sysRes).to.include({ removed: false, state: 'hidden', methodUsed: 'pm uninstall --user 0' });
  });

  it('renders a modern HTML document with CSP nonce, color-scheme, dialog, and table', () => {
    const html = renderWebPage('test-nonce-123', { serial: 'DEV1', filter: 'user', method: 'auto' });
    expect(html).to.include('<meta name="color-scheme" content="light dark">');
    expect(html).to.include('<dialog id="confirm-dialog" closedby="any"');
    expect(html).to.include('<script nonce="test-nonce-123">');
    expect(html).to.include('id="device-arch"');
    expect(html).to.include('id="apk-dropzone"');
    expect(html).to.include('id="apk-file-input"');
    expect(html).to.include('adbkit — Android App Hider');

    expect(extractDeviceAbis({
      'ro.product.cpu.abi': 'arm64-v8a',
      'ro.product.cpu.abilist': 'arm64-v8a,armeabi-v7a,armeabi',
    })).to.deep.equal({
      abi: 'arm64-v8a',
      abiList: ['arm64-v8a', 'armeabi-v7a', 'armeabi'],
    });
    expect(extractDeviceAbis({
      'ro.product.cpu.abilist64': 'x86_64',
      'ro.product.cpu.abilist32': 'x86',
    })).to.deep.equal({
      abi: 'x86_64',
      abiList: ['x86_64', 'x86'],
    });
  });

  it('serves web UI and JSON API endpoints over HTTP', async () => {
    const device = new DeviceClient({} as Client, 'DEV1');
    sinon.stub(device, 'getProperties').resolves({
      'ro.product.model': 'Pixel 8',
      'ro.build.version.release': '15',
      'ro.build.version.sdk': '35',
      'ro.product.cpu.abi': 'arm64-v8a',
      'ro.product.cpu.abilist': 'arm64-v8a',
    } as never);
    const getPackages = sinon.stub(device, 'getPackages');
    getPackages.withArgs('-f', '-u').resolves(['/data/app/one/base.apk=com.example.one']);
    getPackages.withArgs('-e').resolves(['com.example.one']);
    getPackages.withArgs('-d').resolves([]);
    getPackages.withArgs('-3').resolves(['com.example.one']);
    getPackages.withArgs('-s').resolves([]);

    const execOut = sinon.stub(device, 'execOut') as unknown as sinon.SinonStub<
      [command: readonly string[], encoding?: BufferEncoding],
      Promise<string | Buffer>
    >;
    execOut.withArgs(['pm', 'hide', '--user', '0', 'com.example.one'], 'utf8')
      .resolves('Package com.example.one new hidden state: true\n');
    execOut.withArgs(['unzip', '-p', '/data/app/one/base.apk', 'AndroidManifest.xml'])
      .resolves(buildTestManifestAxml('My App', 0));
    let installedTempPath = '';
    const installStub = sinon.stub(device, 'install').callsFake(async (apk) => {
      installedTempPath = typeof apk === 'string' ? apk : '';
      expect(installedTempPath).to.match(/package\.apk$/);
      expect(fs.existsSync(installedTempPath)).to.equal(true);
      return true;
    });

    const fakeClient = {
      listDevices: async () => [{ id: 'DEV1', type: 'device', getClient: () => device }],
      getDevice: () => device,
    } as unknown as Client;
    const session: AdbSession = {
      runWithClient: (fn) => fn(fakeClient),
    };

    const log = sinon.stub(console, 'log');
    const server: http.Server = createAppHiderServer(session, { filter: 'all', method: 'auto' });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;

      const pageRes = await fetch(`${base}/`);
      expect(pageRes.status).to.equal(200);
      expect(pageRes.headers.get('content-security-policy')).to.include("object-src 'none'");
      expect(pageRes.headers.get('x-frame-options')).to.equal('DENY');

      const devRes = await fetch(`${base}/api/devices`);
      const devJson = await devRes.json() as { devices: Array<{ id: string; model: string; abi: string }> };
      expect(devJson.devices).to.have.length(1);
      expect(devJson.devices[0].model).to.equal('Pixel 8');
      expect(devJson.devices[0].abi).to.equal('arm64-v8a');

      const pkgRes = await fetch(`${base}/api/packages?serial=DEV1`);
      const pkgJson = await pkgRes.json() as {
        summary: { abi: string; abiList: string[] };
        apps: AppEntry[];
      };
      expect(pkgJson.summary.abi).to.equal('arm64-v8a');
      expect(pkgJson.summary.abiList).to.deep.equal(['arm64-v8a']);
      expect(pkgJson.apps).to.deep.equal([
        { name: 'com.example.one', state: 'enabled', kind: 'user', apkPath: '/data/app/one/base.apk' },
      ]);

      const metaRes = await fetch(`${base}/api/packages/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial: 'DEV1',
          packages: [{ name: 'com.example.one', apkPath: '/data/app/one/base.apk' }],
        }),
      });
      const metaJson = await metaRes.json() as { items: Array<{ name: string; label?: string; hasIcon: boolean }> };
      expect(metaJson.items).to.deep.equal([{ name: 'com.example.one', label: 'My App', hasIcon: false }]);

      const iconRes = await fetch(`${base}/api/app-icon?serial=DEV1&pkg=com.example.one`);
      expect(iconRes.status).to.equal(204);

      const actRes = await fetch(`${base}/api/packages/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial: 'DEV1',
          action: 'hide',
          method: 'auto',
          packages: [{ name: 'com.example.one', state: 'enabled' }],
        }),
      });
      const actJson = await actRes.json() as { results: Array<{ ok: boolean; state: string }> };
      expect(actJson.results[0]).to.include({ ok: true, state: 'hidden' });

      const badExtRes = await fetch(`${base}/api/packages/install?serial=DEV1&filename=notes.txt`, {
        method: 'POST',
        body: Buffer.from('PK\x03\x04test'),
      });
      expect(badExtRes.status).to.equal(400);

      const badSigRes = await fetch(`${base}/api/packages/install?serial=DEV1&filename=broken.apk`, {
        method: 'POST',
        body: Buffer.from('not-a-zip'),
      });
      expect(badSigRes.status).to.equal(400);
      expect(installStub.called).to.equal(false);

      const fakeApk = Buffer.from('PK\x03\x04fake-apk-payload');
      const installRes = await fetch(`${base}/api/packages/install?serial=DEV1&filename=demo.apk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: fakeApk,
      });
      expect(installRes.status).to.equal(200);
      const installJson = await installRes.json() as { ok: boolean; filename: string; sizeBytes: number };
      expect(installJson).to.include({ ok: true, filename: 'demo.apk', sizeBytes: fakeApk.length });
      expect(installStub.calledOnce).to.equal(true);
      expect(fs.existsSync(installedTempPath)).to.equal(false);

      const logs = log.getCalls().map(c => String(c.args[0]));
      expect(logs.some(line => line.includes('[DEV1] Starting hide'))).to.equal(true);
      expect(logs.some(line => line.includes('[DEV1] Finished hide: 1 succeeded, 0 failed'))).to.equal(true);
      expect(logs.some(line => line.includes('[DEV1] Starting sideload: demo.apk'))).to.equal(true);
      expect(logs.some(line => line.includes('[DEV1] Finished sideload: Sideloaded demo.apk onto DEV1.'))).to.equal(true);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('detects USB busy / claimInterface errors for native ADB fallback', () => {
    expect(isUsbBusyError(new Error("Failure: 'claimInterface error: could not open interface for exclusive access (error 0xe00002c5)'"))).to.equal(true);
    expect(isUsbBusyError(new Error('device offline'))).to.equal(false);
  });

  it('extracts application label, version, and icon resource IDs from binary AXML and ARSC', () => {
    const manifest = buildTestManifestAxml('Direct Label', 0x7f020001, '2.5.1', 20501);
    const info = extractManifestAppInfo(manifest);
    expect(info.labelStr).to.equal('Direct Label');
    expect(info.iconResId).to.equal(0x7f020001);
    expect(info.versionNameStr).to.equal('2.5.1');
    expect(info.versionCode).to.equal(20501);

    const arsc = buildTestArsc('res/mipmap-xxhdpi/ic_launcher.png');
    const table = parseResourcesTable(arsc);
    expect(table.get(0x7f010000)?.[0]?.strValue).to.equal('res/mipmap-xxhdpi/ic_launcher.png');
  });
});

function buildUtf8StringPool(items: string[]): Buffer {
  const stringBuffers = items.map((s) => {
    const utf8 = Buffer.from(s, 'utf8');
    return Buffer.concat([Buffer.from([s.length, utf8.length]), utf8, Buffer.from([0])]);
  });
  const offsetsSize = items.length * 4;
  const stringsData = Buffer.concat(stringBuffers);
  const pad = (4 - (stringsData.length % 4)) % 4;
  const stringsStart = 28 + offsetsSize;
  const totalSize = stringsStart + stringsData.length + pad;
  const buf = Buffer.alloc(totalSize);
  buf.writeUInt16LE(0x0001, 0); // RES_STRING_POOL_TYPE
  buf.writeUInt16LE(28, 2);
  buf.writeUInt32LE(totalSize, 4);
  buf.writeUInt32LE(items.length, 8);
  buf.writeUInt32LE(0, 12);
  buf.writeUInt32LE(0x100, 16); // UTF-8
  buf.writeUInt32LE(stringsStart, 20);
  buf.writeUInt32LE(0, 24);
  let rel = 0;
  for (let i = 0; i < items.length; i++) {
    buf.writeUInt32LE(rel, 28 + i * 4);
    stringBuffers[i].copy(buf, stringsStart + rel);
    rel += stringBuffers[i].length;
  }
  return buf;
}

function buildTestManifestAxml(label: string, iconResId: number, versionName?: string, versionCode?: number): Buffer {
  const strings = ['application', 'label', 'icon', label, 'manifest', 'versionName', 'versionCode'];
  if (versionName) strings.push(versionName);
  const pool = buildUtf8StringPool(strings);

  const resMap = Buffer.alloc(8 + 28);
  resMap.writeUInt16LE(0x0180, 0);
  resMap.writeUInt16LE(8, 2);
  resMap.writeUInt32LE(resMap.length, 4);
  resMap.writeUInt32LE(0, 8);
  resMap.writeUInt32LE(0x01010001, 12); // label
  resMap.writeUInt32LE(0x01010002, 16); // icon
  resMap.writeUInt32LE(0, 20);
  resMap.writeUInt32LE(0, 24);
  resMap.writeUInt32LE(0x0101021c, 28); // versionName
  resMap.writeUInt32LE(0x0101021b, 32); // versionCode

  const chunks: Buffer[] = [pool, resMap];

  const manifestAttrs: Array<[number, number, number, number]> = [];
  if (versionName) manifestAttrs.push([5, 7, 0x03, 7]);
  if (versionCode !== undefined) manifestAttrs.push([6, 0xffffffff, 0x10, versionCode]);
  if (manifestAttrs.length > 0) {
    const mSize = 16 + 20 + manifestAttrs.length * 20;
    const manifestEl = Buffer.alloc(mSize);
    manifestEl.writeUInt16LE(0x0102, 0);
    manifestEl.writeUInt16LE(16, 2);
    manifestEl.writeUInt32LE(mSize, 4);
    manifestEl.writeUInt32LE(0xffffffff, 16);
    manifestEl.writeUInt32LE(4, 20); // 'manifest'
    manifestEl.writeUInt16LE(20, 24);
    manifestEl.writeUInt16LE(20, 26);
    manifestEl.writeUInt16LE(manifestAttrs.length, 28);
    manifestAttrs.forEach(([nameIdx, rawIdx, dataType, data], idx) => {
      const pos = 36 + idx * 20;
      manifestEl.writeUInt32LE(0xffffffff, pos);
      manifestEl.writeUInt32LE(nameIdx, pos + 4);
      manifestEl.writeUInt32LE(rawIdx >>> 0, pos + 8);
      manifestEl.writeUInt16LE(8, pos + 12);
      manifestEl.writeUInt8(dataType, pos + 15);
      manifestEl.writeUInt32LE(data >>> 0, pos + 16);
    });
    chunks.push(manifestEl);
  }

  const attrsCount = iconResId ? 2 : 1;
  const startElSize = 16 + 20 + attrsCount * 20;
  const startEl = Buffer.alloc(startElSize);
  startEl.writeUInt16LE(0x0102, 0);
  startEl.writeUInt16LE(16, 2);
  startEl.writeUInt32LE(startElSize, 4);
  startEl.writeUInt32LE(0xffffffff, 16); // ns
  startEl.writeUInt32LE(0, 20); // 'application'
  startEl.writeUInt16LE(20, 24); // attrStart
  startEl.writeUInt16LE(20, 26); // attrSize
  startEl.writeUInt16LE(attrsCount, 28); // attrCount

  // attr 0: label (string)
  startEl.writeUInt32LE(0xffffffff, 36);
  startEl.writeUInt32LE(1, 40);
  startEl.writeUInt32LE(3, 44);
  startEl.writeUInt16LE(8, 48);
  startEl.writeUInt8(0x03, 51);
  startEl.writeUInt32LE(3, 52);

  if (iconResId) {
    startEl.writeUInt32LE(0xffffffff, 56);
    startEl.writeUInt32LE(2, 60);
    startEl.writeUInt32LE(0xffffffff, 64);
    startEl.writeUInt16LE(8, 68);
    startEl.writeUInt8(0x01, 71);
    startEl.writeUInt32LE(iconResId >>> 0, 72);
  }
  chunks.push(startEl);

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

function buildTestArsc(iconPath: string): Buffer {
  const pool = buildUtf8StringPool([iconPath]);
  const typeHeaderSize = 36;
  const typeChunkSize = typeHeaderSize + 4 + 16;
  const typeChunk = Buffer.alloc(typeChunkSize);
  typeChunk.writeUInt16LE(0x0201, 0);
  typeChunk.writeUInt16LE(typeHeaderSize, 2);
  typeChunk.writeUInt32LE(typeChunkSize, 4);
  typeChunk.writeUInt8(1, 8); // typeId = 1
  typeChunk.writeUInt32LE(1, 12); // entryCount = 1
  typeChunk.writeUInt32LE(typeHeaderSize + 4, 16); // entriesStart
  typeChunk.writeUInt32LE(16, 20); // configSize
  typeChunk.writeUInt16LE(480, 34); // density = xxhdpi
  typeChunk.writeUInt32LE(0, typeHeaderSize); // entry offset 0
  const entryPos = typeHeaderSize + 4;
  typeChunk.writeUInt16LE(8, entryPos); // entrySize
  typeChunk.writeUInt16LE(0, entryPos + 2); // flags
  typeChunk.writeUInt16LE(8, entryPos + 8); // Res_value size
  typeChunk.writeUInt8(0x03, entryPos + 11); // TYPE_STRING
  typeChunk.writeUInt32LE(0, entryPos + 12); // string index 0

  const pkgHeaderSize = 288;
  const pkgSize = pkgHeaderSize + typeChunk.length;
  const pkgHeader = Buffer.alloc(pkgHeaderSize);
  pkgHeader.writeUInt16LE(0x0200, 0);
  pkgHeader.writeUInt16LE(pkgHeaderSize, 2);
  pkgHeader.writeUInt32LE(pkgSize, 4);
  pkgHeader.writeUInt32LE(0x7f, 8); // pkgId

  const totalSize = 12 + pool.length + pkgSize;
  const tableHeader = Buffer.alloc(12);
  tableHeader.writeUInt16LE(0x0002, 0);
  tableHeader.writeUInt16LE(12, 2);
  tableHeader.writeUInt32LE(totalSize, 4);
  tableHeader.writeUInt32LE(1, 8);
  return Buffer.concat([tableHeader, pool, pkgHeader, typeChunk]);
}
