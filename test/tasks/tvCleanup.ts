import { expect } from 'chai';
import type http from 'node:http';
import sinon from 'sinon';
import Client from '../../src/adb/client.js';
import DeviceClient from '../../src/adb/DeviceClient.js';
import { type AdbSession } from '../../tasks/hideApps.js';
import {
  TV_CRITICAL_PACKAGES,
  TV_OPTIMIZE_FIXES,
  TV_REMOTE_KEYS,
  applyTvOptimizeFix,
  createTvCleanupServer,
  formatRemoteInputText,
  isAllowedTempFilePath,
  isTvBloatware,
  isTvOptimizeFixId,
  parseDfOutput,
  parseMemInfo,
  parseMemInfoDetails,
  parseRunningPackages,
  parseTempFilesOutput,
  parseTopMemoryProcesses,
  parseTvCliArgs,
  renderTvCleanupPage,
} from '../../tasks/tvCleanup.js';

describe('tasks/tvCleanup', () => {
  afterEach(() => sinon.restore());

  it('parses TV IP positional and flag arguments with default port 5555', () => {
    expect(parseTvCliArgs(['192.168.1.42'])).to.deep.equal({
      tvIp: '192.168.1.42',
      tvHost: '192.168.1.42',
      tvPort: 5555,
      tvSerial: '192.168.1.42:5555',
      host: undefined,
      port: undefined,
      uiHost: '127.0.0.1',
      uiPort: 3334,
      backend: undefined,
      openBrowser: true,
      help: false,
    });

    expect(parseTvCliArgs(['--ip', '10.0.0.8:5556', '--ui-port', '4567', '--no-open', '--backend', 'native'])).to.include({
      tvHost: '10.0.0.8',
      tvPort: 5556,
      tvSerial: '10.0.0.8:5556',
      uiPort: 4567,
      backend: 'native',
      openBrowser: false,
    });

    expect(() => parseTvCliArgs([])).to.throw('Missing TV IP address');
    expect(() => parseTvCliArgs(['--ui-port', 'bad', '192.168.1.1'])).to.throw('Invalid value for --ui-port');
  });

  it('parses df storage, /proc/meminfo, running ps entries, and temp files', () => {
    const df = `Filesystem      1K-blocks    Used Available Use% Mounted on
/dev/block/dm-5   8388608 6291456   2097152  75% /data`;
    expect(parseDfOutput(df)).to.deep.equal({
      totalBytes: 8388608 * 1024,
      usedBytes: 6291456 * 1024,
      availableBytes: 2097152 * 1024,
      usedPercent: 75,
    });

    const mem = `MemTotal:        2097152 kB
MemFree:          100000 kB
MemAvailable:     524288 kB
Cached:           400000 kB`;
    expect(parseMemInfo(mem)).to.deep.equal({
      totalBytes: 2097152 * 1024,
      usedBytes: (2097152 - 524288) * 1024,
      availableBytes: 524288 * 1024,
      usedPercent: 75,
    });
    expect(parseMemInfoDetails(mem)).to.deep.equal([
      { key: 'MemTotal', label: 'Total RAM', bytes: 2097152 * 1024 },
      { key: 'MemAvailable', label: 'Available RAM', bytes: 524288 * 1024 },
      { key: 'MemFree', label: 'Free RAM', bytes: 100000 * 1024 },
      { key: 'Cached', label: 'Page Cache', bytes: 400000 * 1024 },
    ]);
    expect(parseTopMemoryProcesses([
      { PID: '101', NAME: 'com.small.app', RSS: '1024' },
      { PID: '202', NAME: 'com.netflix.ninja', RSS: '204800' },
    ])).to.deep.equal([
      { pid: '202', name: 'com.netflix.ninja', user: undefined, rssBytes: 204800 * 1024 },
      { pid: '101', name: 'com.small.app', user: undefined, rssBytes: 1024 * 1024 },
    ]);

    const running = parseRunningPackages([
      { NAME: 'com.netflix.ninja' },
      { NAME: 'com.google.android.youtube.tv:remote' },
      { NAME: 'surfaceflinger' },
    ]);
    expect([...running]).to.deep.equal(['com.netflix.ninja', 'com.google.android.youtube.tv']);

    const lsOut = `total 120
-rw-r--r-- 1 shell shell 1048576 2026-11-24 06:00 update.apk
-rw-r--r-- 1 shell shell     512 2026-11-24 06:00 keep.txt`;
    expect(parseTempFilesOutput(lsOut, '/data/local/tmp')).to.deep.equal([
      { path: '/data/local/tmp/update.apk', sizeBytes: 1048576 },
    ]);

    expect(isAllowedTempFilePath('/data/local/tmp/update.apk')).to.equal(true);
    expect(isAllowedTempFilePath('/data/local/tmp/../etc/passwd')).to.equal(false);
    expect(isAllowedTempFilePath('/system/app/foo.apk')).to.equal(false);
    expect(isTvBloatware('com.google.android.videos')).to.equal(true);
    expect(isTvBloatware('com.tcl.bi')).to.equal(true);
    expect(isTvBloatware('com.tcl.guard')).to.equal(true);
    expect(isTvBloatware('com.tcl.system.server')).to.equal(false);
    expect(isTvBloatware('com.tcl.settings')).to.equal(false);
    expect(isTvBloatware('com.tcl.inputmethod.international')).to.equal(false);
    expect(isTvBloatware('com.custom.mediaplayer')).to.equal(false);
    expect(TV_CRITICAL_PACKAGES.has('com.tcl.system.server')).to.equal(true);
    expect(isTvOptimizeFixId('disable-tcl-telemetry')).to.equal(true);
    expect(isTvOptimizeFixId('enable-adguard-dns')).to.equal(true);
    expect(isTvOptimizeFixId('nonexistent-fix')).to.equal(false);
    expect(TV_OPTIMIZE_FIXES.length).to.be.greaterThan(5);
    for (const fix of TV_OPTIMIZE_FIXES) {
      expect(fix.label.length).to.be.greaterThan(0);
      expect(fix.summary.length).to.be.greaterThan(0);
      expect(fix.description.length).to.be.greaterThan(20);
      expect(fix.commands.length).to.be.greaterThan(0);
    }
    expect(TV_REMOTE_KEYS.home).to.equal(3);
    expect(TV_REMOTE_KEYS.center).to.equal(23);
    expect(formatRemoteInputText('hello world')).to.equal('hello%sworld');
    expect(() => formatRemoteInputText('bad\nline')).to.throw('Control characters');
  });

  it('renders modern HTML page with CSP nonce, progress bars, dialog, and table', () => {
    const html = renderTvCleanupPage('nonce-tv-1', {
      tvSerial: '192.168.1.42:5555',
      tvHost: '192.168.1.42',
      tvPort: 5555,
    });
    expect(html).to.include('<meta name="color-scheme" content="light dark">');
    expect(html).to.include('<progress id="storage-progress" max="100"></progress>');
    expect(html).to.include('<dialog id="confirm-dialog" closedby="any"');
    expect(html).to.include('<script nonce="nonce-tv-1">');
    expect(html).to.include('id="tv-arch"');
    expect(html).to.include('id="memory-details-btn"');
    expect(html).to.include('id="memory-dialog"');
    expect(html).to.include('id="remote-btn"');
    expect(html).to.include('id="remote-dialog"');
    expect(html).to.include('id="optimize-btn"');
    expect(html).to.include('command="show-modal" commandfor="optimize-dialog"');
    expect(html).to.include('<dialog id="optimize-dialog" closedby="any"');
    expect(html).to.include('id="optimize-inspector"');
    expect(html).to.include('id="optimize-list"');
    expect(html).to.include('id="optimize-feedback"');
    expect(html).to.include('command="close" commandfor="optimize-dialog"');
    expect(html).to.include('Disable TCL Telemetry & Promo Bloat');
    expect(html).to.include('Enable AdGuard Private DNS');
    expect(html).to.include('chip-delete-btn');
    expect(html).to.include('id="apk-dropzone"');
    expect(html).to.include('<th>Version</th>');
    expect(html).to.include('id="uninstall-selected-btn"');
  });

  it('serves TV status and cleanup endpoints over local HTTP', async () => {
    const device = new DeviceClient({} as Client, '192.168.1.42:5555');
    sinon.stub(device, 'install').resolves(true);
    sinon.stub(device, 'getProperties').resolves({
      'ro.product.model': 'SHIELD Android TV',
      'ro.build.version.release': '11',
      'ro.build.version.sdk': '30',
      'ro.product.cpu.abi': 'arm64-v8a',
      'ro.product.cpu.abilist': 'arm64-v8a,armeabi-v7a,armeabi',
    } as never);
    sinon.stub(device, 'getPs').resolves([{ PID: '420', NAME: 'com.netflix.ninja', RSS: '150000' }] as never);
    sinon.stub(device, 'clear').resolves(true);

    const getPackages = sinon.stub(device, 'getPackages');
    getPackages.withArgs('-f', '-u').resolves(['/system/app/Netflix/Netflix.apk=com.netflix.ninja']);
    getPackages.withArgs('-e').resolves(['com.netflix.ninja']);
    getPackages.withArgs('-d').resolves([]);
    getPackages.withArgs('-3').resolves([]);
    getPackages.withArgs('-s').resolves(['com.netflix.ninja']);

    const execOut = sinon.stub(device, 'execOut') as unknown as sinon.SinonStub<
      [command: readonly string[], encoding?: BufferEncoding],
      Promise<string | Buffer>
    >;
    execOut.withArgs(['df', '-k', '/data'], 'utf8').resolves('Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/dm-0 4000 1000 3000 25% /data\n');
    execOut.withArgs(['cat', '/proc/meminfo'], 'utf8').resolves('MemTotal: 2000 kB\nMemAvailable: 1000 kB\n');
    execOut.withArgs(['ls', '-l', '/data/local/tmp'], 'utf8').resolves('-rw-r--r-- 1 shell shell 2048 2026-11-24 06:00 old.apk\n');
    execOut.withArgs(['ls', '-l', '/sdcard/Download'], 'utf8').resolves('');
    execOut.withArgs([
      'cmd',
      'package',
      'query-activities',
      '--components',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
    ], 'utf8').resolves('com.netflix.ninja/.MainActivity\n');
    execOut.withArgs(['pm', 'trim-caches', '999999999999'], 'utf8').resolves('');
    execOut.withArgs(['am', 'force-stop', 'com.netflix.ninja'], 'utf8').resolves('');
    execOut.withArgs(['rm', '-f', '/data/local/tmp/old.apk'], 'utf8').resolves('');
    execOut.withArgs(['pm', 'uninstall', 'com.netflix.ninja'], 'utf8').resolves('Failure [DELETE_FAILED_INTERNAL_ERROR]\n');
    execOut.withArgs(['pm', 'uninstall', '--user', '0', 'com.netflix.ninja'], 'utf8').resolves('Success\n');
    execOut.withArgs(['unzip', '-p', '/system/app/Netflix/Netflix.apk', 'AndroidManifest.xml'])
      .resolves(buildTvManifestAxml('Netflix', '10.2.0', 50420));
    execOut.withArgs(['input', 'keyevent', '3'], 'utf8').resolves('');
    execOut.withArgs(['input', 'text', 'hello%stv'], 'utf8').resolves('');

    const fakeClient = {
      connect: sinon.stub().resolves(true),
      getDevice: () => device,
    } as unknown as Client;
    const session: AdbSession = {
      runWithClient: (fn) => fn(fakeClient),
    };

    const log = sinon.stub(console, 'log');
    const server: http.Server = createTvCleanupServer(session, {
      tvSerial: '192.168.1.42:5555',
      tvHost: '192.168.1.42',
      tvPort: 5555,
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;

      const pageRes = await fetch(`${base}/`);
      expect(pageRes.status).to.equal(200);
      expect(pageRes.headers.get('x-frame-options')).to.equal('DENY');

      const statusRes = await fetch(`${base}/api/tv/status`);
      const statusJson = await statusRes.json() as {
        summary: { model: string; abi: string; abiList: string[] };
        storage: { usedPercent: number };
        memory: { usedPercent: number };
        memoryDetails: Array<{ key: string; bytes: number }>;
        topProcesses: Array<{ pid: string; name: string; rssBytes: number }>;
        apps: Array<{ name: string; running: boolean; suggestedBloat: boolean; inLauncher?: boolean }>;
        tempFiles: Array<{ path: string }>;
      };
      expect(statusJson.summary.model).to.equal('SHIELD Android TV');
      expect(statusJson.summary.abi).to.equal('arm64-v8a');
      expect(statusJson.summary.abiList).to.deep.equal(['arm64-v8a', 'armeabi-v7a', 'armeabi']);
      expect(statusJson.storage.usedPercent).to.equal(25);
      expect(statusJson.memory.usedPercent).to.equal(50);
      expect(statusJson.memoryDetails.map(d => d.key)).to.deep.equal(['MemTotal', 'MemAvailable']);
      expect(statusJson.topProcesses).to.deep.equal([
        { pid: '420', name: 'com.netflix.ninja', rssBytes: 150000 * 1024 },
      ]);
      expect(statusJson.apps[0]).to.include({
        name: 'com.netflix.ninja',
        running: true,
        suggestedBloat: true,
        inLauncher: true,
      });
      expect(statusJson.tempFiles).to.deep.equal([{ path: '/data/local/tmp/old.apk', sizeBytes: 2048 }]);

      const trimRes = await fetch(`${base}/api/tv/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.42:5555', type: 'trim-caches' }),
      });
      expect(trimRes.status).to.equal(200);

      const stopRes = await fetch(`${base}/api/tv/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.42:5555', type: 'force-stop', packages: ['com.netflix.ninja'] }),
      });
      expect(stopRes.status).to.equal(200);

      const cleanTempRes = await fetch(`${base}/api/tv/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.42:5555', type: 'clean-temp', paths: ['/data/local/tmp/old.apk'] }),
      });
      expect(cleanTempRes.status).to.equal(200);

      const uninstallRes = await fetch(`${base}/api/packages/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial: '192.168.1.42:5555',
          action: 'uninstall',
          method: 'auto',
          packages: [{ name: 'com.netflix.ninja', state: 'enabled' }],
        }),
      });
      const uninstallJson = await uninstallRes.json() as {
        results: Array<{ ok: boolean; removed?: boolean; state?: string; methodUsed?: string }>;
      };
      expect(uninstallJson.results[0]).to.include({
        ok: true,
        removed: false,
        state: 'hidden',
        methodUsed: 'pm uninstall --user 0',
      });

      const metaRes = await fetch(`${base}/api/packages/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial: '192.168.1.42:5555',
          packages: [{ name: 'com.netflix.ninja', apkPath: '/system/app/Netflix/Netflix.apk' }],
        }),
      });
      const metaJson = await metaRes.json() as {
        items: Array<{ name: string; label?: string; versionName?: string; versionCode?: number; hasIcon: boolean }>;
      };
      expect(metaJson.items).to.deep.equal([
        { name: 'com.netflix.ninja', label: 'Netflix', versionName: '10.2.0', versionCode: 50420, hasIcon: false },
      ]);

      const cachedStatusRes = await fetch(`${base}/api/tv/status`);
      const cachedStatusJson = await cachedStatusRes.json() as {
        apps: Array<{ name: string; versionName?: string; versionCode?: number }>;
      };
      expect(cachedStatusJson.apps[0]).to.include({
        name: 'com.netflix.ninja',
        versionName: '10.2.0',
        versionCode: 50420,
      });

      const logs = log.getCalls().map(c => String(c.args[0]));
      expect(logs.some(line => line.includes('Starting trim-caches'))).to.equal(true);

      const sideloadRes = await fetch(`${base}/api/packages/install?filename=tv-app.apk`, {
        method: 'POST',
        body: Buffer.from('PK\x03\x04tv-apk'),
      });
      expect(sideloadRes.status).to.equal(200);
      const logsAfterSideload = log.getCalls().map(c => String(c.args[0]));
      expect(logsAfterSideload.some(line => line.includes('[192.168.1.42:5555] Starting sideload: tv-app.apk'))).to.equal(true);
      expect(logsAfterSideload.some(line => line.includes('[192.168.1.42:5555] Finished sideload'))).to.equal(true);

      const badRemoteRes = await fetch(`${base}/api/tv/remote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.42:5555', key: 'invalid-key' }),
      });
      expect(badRemoteRes.status).to.equal(400);

      const keyRemoteRes = await fetch(`${base}/api/tv/remote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.42:5555', key: 'home' }),
      });
      expect(keyRemoteRes.status).to.equal(200);
      expect(await keyRemoteRes.json()).to.include({ ok: true, key: 'home', keyCode: 3 });

      const textRemoteRes = await fetch(`${base}/api/tv/remote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.42:5555', text: 'hello tv' }),
      });
      expect(textRemoteRes.status).to.equal(200);
      const logsAfterRemote = log.getCalls().map(c => String(c.args[0]));
      expect(logsAfterRemote.some(line => line.includes('Starting remote-key: home (3)'))).to.equal(true);
      expect(logsAfterRemote.some(line => line.includes('Finished remote-key'))).to.equal(true);
      expect(logsAfterRemote.some(line => line.includes('Starting remote-text'))).to.equal(true);
      expect(logsAfterRemote.some(line => line.includes('Finished remote-text'))).to.equal(true);
      expect(logs.some(line => line.includes('Finished trim-caches'))).to.equal(true);
      expect(logs.some(line => line.includes('Starting force-stop'))).to.equal(true);
      expect(logs.some(line => line.includes('Finished force-stop'))).to.equal(true);
      expect(logs.some(line => line.includes('Starting clean-temp'))).to.equal(true);
      expect(logs.some(line => line.includes('Finished clean-temp'))).to.equal(true);
      expect(logs.some(line => line.includes('Starting uninstall'))).to.equal(true);
      expect(logs.some(line => line.includes('Finished uninstall: 1 succeeded, 0 failed'))).to.equal(true);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('applies and reverts optimize fixes over /api/tv/optimize and exposes live settings', async () => {
    const device = new DeviceClient({} as Client, '192.168.1.16:5555');
    sinon.stub(device, 'reboot').resolves(true);
    sinon.stub(device, 'getProperties').resolves({
      'ro.product.model': 'Smart TV Pro',
      'ro.build.version.release': '11',
      'ro.build.version.sdk': '30',
      'ro.product.cpu.abi': 'armeabi-v7a',
    } as never);
    sinon.stub(device, 'getPs').resolves([
      { PID: '101', NAME: 'com.tcl.bi:service', RSS: '42000' },
      { PID: '102', NAME: 'com.tcl.system.server', RSS: '15000' },
    ] as never);

    const getPackages = sinon.stub(device, 'getPackages');
    getPackages.withArgs('-f', '-u').resolves([
      '/product/app/TCL_ALL_BI/TCL_ALL_BI.apk=com.tcl.bi',
      '/product/app/TGuard/TGuard.apk=com.tcl.guard',
      '/product/app/TclServerBackUp/TclServerBackUp.apk=com.tcl.system.server',
    ]);
    getPackages.withArgs('-e').resolves(['com.tcl.bi', 'com.tcl.system.server']);
    getPackages.withArgs('-d').resolves(['com.tcl.guard']);
    getPackages.withArgs('-3').resolves([]);
    getPackages.withArgs('-s').resolves(['com.tcl.bi', 'com.tcl.guard', 'com.tcl.system.server']);

    const execOut = sinon.stub(device, 'execOut') as unknown as sinon.SinonStub<
      [command: readonly string[], encoding?: BufferEncoding],
      Promise<string | Buffer>
    >;
    execOut.withArgs(['df', '-k', '/data'], 'utf8').resolves('Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/dm-0 4000 1000 3000 25% /data\n');
    execOut.withArgs(['cat', '/proc/meminfo'], 'utf8').resolves('MemTotal: 2000 kB\nMemAvailable: 1000 kB\n');
    execOut.withArgs(['ls', '-l', '/data/local/tmp'], 'utf8').resolves('');
    execOut.withArgs(['ls', '-l', '/sdcard/Download'], 'utf8').resolves('');
    execOut.withArgs([
      'cmd',
      'package',
      'query-activities',
      '--components',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
    ], 'utf8').resolves('');
    execOut.withArgs(['settings', 'get', 'global', 'private_dns_mode'], 'utf8').resolves('null\n');
    execOut.withArgs(['settings', 'get', 'global', 'private_dns_specifier'], 'utf8').resolves('null\n');
    execOut.withArgs(['settings', 'get', 'secure', 'location_mode'], 'utf8').resolves('3\n');
    execOut.withArgs(['settings', 'get', 'global', 'activity_starts_logging_enabled'], 'utf8').resolves('1\n');
    execOut.withArgs(['settings', 'get', 'global', 'window_animation_scale'], 'utf8').resolves('1.0\n');
    execOut.withArgs(['settings', 'get', 'global', 'transition_animation_scale'], 'utf8').resolves('1.0\n');
    execOut.withArgs(['settings', 'get', 'global', 'animator_duration_scale'], 'utf8').resolves('null\n');
    execOut.withArgs(['settings', 'get', 'global', 'tcl_diagnostic_status'], 'utf8').resolves('0\n');
    execOut.withArgs(['settings', 'get', 'global', 'tcl_uxp_status'], 'utf8').resolves('0\n');

    execOut.withArgs(['pm', 'disable-user', '--user', '0', 'com.tcl.bi'], 'utf8').resolves('Package com.tcl.bi new state: disabled-user\n');
    execOut.withArgs(['am', 'force-stop', 'com.tcl.bi'], 'utf8').resolves('');
    execOut.withArgs(['pm', 'enable', '--user', '0', 'com.tcl.guard'], 'utf8').resolves('Package com.tcl.guard new state: enabled\n');
    execOut.withArgs(['settings', 'put', 'global', 'private_dns_mode', 'hostname'], 'utf8').resolves('');
    execOut.withArgs(['settings', 'put', 'global', 'private_dns_specifier', 'dns.adguard-dns.com'], 'utf8').resolves('');
    execOut.withArgs(['settings', 'put', 'global', 'private_dns_mode', 'opportunistic'], 'utf8').resolves('');
    execOut.withArgs(['settings', 'delete', 'global', 'private_dns_specifier'], 'utf8').resolves('');
    execOut.withArgs(['settings', 'put', 'secure', 'location_mode', '0'], 'utf8').resolves('');
    execOut.withArgs(['settings', 'put', 'global', 'activity_starts_logging_enabled', '0'], 'utf8').resolves('');
    execOut.withArgs(['settings', 'put', 'global', 'tcl_diagnostic_status', '0'], 'utf8').resolves('');
    execOut.withArgs(['settings', 'put', 'global', 'tcl_uxp_status', '0'], 'utf8').resolves('');
    execOut.withArgs(['settings', 'put', 'global', 'window_animation_scale', '0.5'], 'utf8').resolves('');
    execOut.withArgs(['settings', 'put', 'global', 'transition_animation_scale', '0.5'], 'utf8').resolves('');
    execOut.withArgs(['settings', 'put', 'global', 'animator_duration_scale', '0.5'], 'utf8').resolves('');
    execOut.withArgs(['pm', 'trim-caches', '999999999999'], 'utf8').resolves('');

    const fakeClient = {
      connect: sinon.stub().resolves(true),
      getDevice: () => device,
    } as unknown as Client;
    const session: AdbSession = {
      runWithClient: (fn) => fn(fakeClient),
    };

    const log = sinon.stub(console, 'log');
    const server: http.Server = createTvCleanupServer(session, {
      tvSerial: '192.168.1.16:5555',
      tvHost: '192.168.1.16',
      tvPort: 5555,
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;

      const statusRes = await fetch(`${base}/api/tv/status`);
      const statusJson = await statusRes.json() as {
        optimizeSettings: {
          privateDnsMode: string | null;
          locationMode: string | null;
          activityStartsLogging: string | null;
          windowAnimationScale: string | null;
        };
      };
      expect(statusJson.optimizeSettings).to.include({
        privateDnsMode: null,
        locationMode: '3',
        activityStartsLogging: '1',
        windowAnimationScale: '1.0',
      });

      const badFixRes = await fetch(`${base}/api/tv/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.16:5555', fixId: 'not-a-fix' }),
      });
      expect(badFixRes.status).to.equal(400);

      const badRevertRes = await fetch(`${base}/api/tv/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.16:5555', fixId: 'reboot-tv', mode: 'revert' }),
      });
      expect(badRevertRes.status).to.equal(400);

      const tclRes = await fetch(`${base}/api/tv/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.16:5555', fixId: 'disable-tcl-telemetry', mode: 'apply' }),
      });
      expect(tclRes.status).to.equal(200);
      expect(await tclRes.json()).to.deep.include({
        ok: true,
        fixId: 'disable-tcl-telemetry',
        mode: 'apply',
        applied: ['com.tcl.bi'],
        skipped: ['com.tcl.guard'],
        failed: [],
      });

      const tclUndoRes = await fetch(`${base}/api/tv/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.16:5555', fixId: 'disable-tcl-telemetry', mode: 'revert' }),
      });
      expect(tclUndoRes.status).to.equal(200);
      expect(await tclUndoRes.json()).to.deep.include({
        ok: true,
        fixId: 'disable-tcl-telemetry',
        mode: 'revert',
        applied: ['com.tcl.guard'],
        skipped: ['com.tcl.bi'],
      });

      const dnsRes = await fetch(`${base}/api/tv/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.16:5555', fixId: 'enable-adguard-dns', mode: 'apply' }),
      });
      expect(dnsRes.status).to.equal(200);
      expect(await dnsRes.json()).to.include({ ok: true, fixId: 'enable-adguard-dns', mode: 'apply' });

      const dnsUndo = await applyTvOptimizeFix(device, 'enable-adguard-dns', 'revert');
      expect(dnsUndo.ok).to.equal(true);

      const tracking = await applyTvOptimizeFix(device, 'disable-tracking-settings', 'apply');
      expect(tracking.ok).to.equal(true);
      expect(tracking.applied).to.include('location_mode=0');

      const anim = await applyTvOptimizeFix(device, 'speedup-animations', 'apply');
      expect(anim.ok).to.equal(true);

      const trim = await applyTvOptimizeFix(device, 'trim-caches-and-stop-bloat', 'apply');
      expect(trim.ok).to.equal(true);
      expect(trim.applied).to.include('com.tcl.bi');
      expect(trim.applied).to.not.include('com.tcl.system.server');

      const rebootRes = await fetch(`${base}/api/tv/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: '192.168.1.16:5555', fixId: 'reboot-tv', mode: 'apply' }),
      });
      expect(rebootRes.status).to.equal(200);
      expect(await rebootRes.json()).to.include({ ok: true, disconnected: true });

      const logs = log.getCalls().map(c => String(c.args[0]));
      expect(logs.some(line => line.includes('Starting optimize: apply:disable-tcl-telemetry'))).to.equal(true);
      expect(logs.some(line => line.includes('Finished optimize'))).to.equal(true);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

function buildTvManifestAxml(label: string, versionName: string, versionCode: number): Buffer {
  const strings = ['manifest', 'versionName', 'versionCode', versionName, 'application', 'label', label];
  const encoded = strings.map((s) => {
    const utf8 = Buffer.from(s, 'utf8');
    return Buffer.concat([Buffer.from([s.length, utf8.length]), utf8, Buffer.from([0])]);
  });
  const data = Buffer.concat(encoded);
  const pad = (4 - (data.length % 4)) % 4;
  const stringsStart = 28 + strings.length * 4;
  const poolSize = stringsStart + data.length + pad;
  const pool = Buffer.alloc(poolSize);
  pool.writeUInt16LE(0x0001, 0);
  pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(poolSize, 4);
  pool.writeUInt32LE(strings.length, 8);
  pool.writeUInt32LE(0x100, 16);
  pool.writeUInt32LE(stringsStart, 20);
  let rel = 0;
  for (let i = 0; i < strings.length; i++) {
    pool.writeUInt32LE(rel, 28 + i * 4);
    encoded[i].copy(pool, stringsStart + rel);
    rel += encoded[i].length;
  }

  const resMap = Buffer.alloc(8 + 24);
  resMap.writeUInt16LE(0x0180, 0);
  resMap.writeUInt16LE(8, 2);
  resMap.writeUInt32LE(resMap.length, 4);
  resMap.writeUInt32LE(0x0101021c, 12); // versionName -> idx 1
  resMap.writeUInt32LE(0x0101021b, 16); // versionCode -> idx 2
  resMap.writeUInt32LE(0x01010001, 28); // label -> idx 5

  const makeEl = (tagIdx: number, attrs: Array<[number, number, number, number]>): Buffer => {
    const size = 36 + attrs.length * 20;
    const el = Buffer.alloc(size);
    el.writeUInt16LE(0x0102, 0);
    el.writeUInt16LE(16, 2);
    el.writeUInt32LE(size, 4);
    el.writeUInt32LE(0xffffffff, 16);
    el.writeUInt32LE(tagIdx, 20);
    el.writeUInt16LE(20, 24);
    el.writeUInt16LE(20, 26);
    el.writeUInt16LE(attrs.length, 28);
    attrs.forEach(([nameIdx, rawIdx, type, val], i) => {
      const p = 36 + i * 20;
      el.writeUInt32LE(0xffffffff, p);
      el.writeUInt32LE(nameIdx, p + 4);
      el.writeUInt32LE(rawIdx >>> 0, p + 8);
      el.writeUInt16LE(8, p + 12);
      el.writeUInt8(type, p + 15);
      el.writeUInt32LE(val >>> 0, p + 16);
    });
    return el;
  };

  const manifestEl = makeEl(0, [
    [1, 3, 0x03, 3],
    [2, 0xffffffff, 0x10, versionCode],
  ]);
  const appEl = makeEl(4, [[5, 6, 0x03, 6]]);
  const body = Buffer.concat([pool, resMap, manifestEl, appEl]);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}
