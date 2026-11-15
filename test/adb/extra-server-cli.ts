import { expect } from 'chai';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import DeviceClientExtra from '../../src/adb/DeviceClientExtra.js';
import type DeviceClient from '../../src/adb/DeviceClient.js';
import Server from '../../src/adb/tcpusb/server.js';
import type Client from '../../src/adb/client.js';

describe('DeviceClientExtra', () => {
  it('formats service, tap and key commands', async () => {
    const calls: unknown[] = [];
    const extra = new DeviceClientExtra({ execOut: async (...args: unknown[]) => { calls.push(args); return 'ok'; } } as unknown as DeviceClient);
    expect(await extra.setSvc('wifi', false)).to.equal('ok');
    await extra.tap(10, 20);
    await extra.back();
    expect(calls[0]).to.deep.equal([['svc', 'wifi', 'disable'], 'utf8']);
    expect(calls[1]).to.deep.equal([['input', 'tap', 10, 20], 'utf8']);
    expect((calls[2] as unknown[][])[0].slice(0, 2)).to.deep.equal(['input', 'keyevent']);
  });
});

describe('TcpUsbServer', () => {
  it('forwards server events and delegates lifecycle methods', () => {
    const server = new Server({} as Client, 'serial', { auth: async () => {} });
    const underlying = (server as unknown as { server: EventEmitter & { listen: (...args: unknown[]) => void; close: () => void } }).server;
    let listening = false;
    let closed = false;
    let error: Error | undefined;
    server.on('listening', () => { listening = true; });
    server.on('close', () => { closed = true; });
    server.on('error', err => { error = err; });
    underlying.listen = () => { underlying.emit('listening'); };
    underlying.close = () => { underlying.emit('close'); };
    expect(server.listen(0)).to.equal(server);
    const failure = new Error('failed');
    underlying.emit('error', failure);
    expect(server.close()).to.equal(server);
    expect(server.end()).to.equal(server);
    expect([listening, closed, error]).to.deep.equal([true, true, failure]);
  });
});

describe('CLI', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { encoding: 'utf8' });
  it('shows correct commands and global options', () => {
    const help = execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--help'], { encoding: 'utf8' });
    expect(help).to.include('--backend <backend>');
    expect(help).to.include('Disable wifi.');
    expect(help).to.include('Enable data.');
  });
  it('reports missing packet files and rejects invalid options', function () {
    this.timeout(10000);
    const missing = run('parse-tcp-packets', '/missing-adbkit-packet-file');
    expect(missing.status).to.equal(1);
    expect(missing.stderr).to.include('ENOENT');
    expect(missing.stderr).not.to.include('Unhandled');
    expect(run('--backend', 'invalid', 'parse-tcp-packets', 'x').status).to.equal(1);
    expect(run('--port', 'oops', 'parse-tcp-packets', 'x').status).to.equal(1);
    for (const port of ['0', '65536', '1.5', 'abc']) {
      const result = run('usb-device-to-tcp', 'serial', '--port', port);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('Port must be an integer between 1 and 65535');
    }
  });
});
