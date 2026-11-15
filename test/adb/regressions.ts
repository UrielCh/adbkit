import { expect } from 'chai';
import MockConnection from '../mock/connection.js';
import Protocol from '../../src/adb/protocol.js';
import { syncPull, syncPush } from '../../src/adb/DeviceSyncHelper.js';
import { installApk } from '../../src/adb/DevicePackageHelper.js';
import type Sync from '../../src/adb/sync.js';
import type PushTransfer from '../../src/adb/sync/pushtransfer.js';
import ShellCommand from '../../src/adb/command/host-transport/shell.js';
import ExecCommand from '../../src/adb/command/host-transport/exec.js';

describe('lifecycle regressions', () => {
  it('closes sync when pull or push setup fails', async () => {
    for (const operation of ['pull', 'push'] as const) {
      let ended = 0;
      const error = new Error('setup failed');
      const sync = { end: () => { ended++; }, pull: async () => { throw error; }, push: async () => { throw error; } } as unknown as Sync;
      let caught: unknown;
      try {
        if (operation === 'pull') await syncPull(async () => sync, '/a');
        else await syncPush(async () => sync, '/a', '/b');
      } catch (err) { caught = err; }
      expect(caught).to.equal(error);
      expect(ended).to.equal(1);
    }
  });

  it('uses distinct temporary names for identical APK paths', async () => {
    const paths: string[] = [];
    const args = { apk: '/tmp/app.apk', push: async (_: unknown, path: string) => {
      paths.push(path);
      return { waitForEnd: async () => {} } as unknown as PushTransfer;
    }, installRemote: async () => true };
    await Promise.all([installApk(args), installApk(args)]);
    expect(paths[0]).not.to.equal(paths[1]);
  });

  for (const [kind, Ctor] of [['shell', ShellCommand], ['exec', ExecCommand]] as const) {
    it(`formats ArrayLike arguments for ${kind}`, async () => {
      const conn = new MockConnection();
      let sent = '';
      conn.getSocket().on('write', chunk => { sent = chunk.toString(); });
      setImmediate(() => { conn.getSocket().causeRead(Protocol.OKAY); conn.getSocket().causeEnd(); });
      await new Ctor(conn).execute({ 0: 'echo', 1: 'hello world', length: 2 });
      expect(sent).to.equal(Protocol.encodeData(`${kind}:'echo' 'hello world'`).toString());
    });
  }
});

describe('ya-webadb regressions', () => {
  it('parses IPv6 hosts consistently', async () => {
    const { parseHostPort } = await import('../../src/adb/parseHostPort.js');
    expect(parseHostPort('[::1]:1234', 5555)).to.deep.equal({ host: '[::1]', port: 1234 });
    expect(parseHostPort('::1', 5555)).to.deep.equal({ host: '[::1]', port: 5555 });
  });

  it('tracks reverse tunnels separately and removes their local handlers', async () => {
    const { YaWebAdbManager } = await import('../../src/adb/yawebadb/manager.js');
    const removed: string[] = [];
    const adb = { transport: { removeReverseTunnel: async (local: string) => { removed.push(local); } } } as unknown as import('../../src/adb/yawebadb/types.js').AdbLike;
    const manager = new YaWebAdbManager();
    manager.markReverseTunnelAdded(adb, 'tcp:1', 'tcp:10');
    manager.markReverseTunnelAdded(adb, 'tcp:2', 'tcp:20');
    await manager.removeReverseTunnels(adb, 'tcp:1');
    expect(removed).to.deep.equal(['tcp:10']);
    await manager.removeReverseTunnels(adb);
    expect(removed).to.deep.equal(['tcp:10', 'tcp:20']);
    await manager.killAll();
  });
});
