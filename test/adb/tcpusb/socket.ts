import { expect } from 'chai';
import type Net from 'node:net';
import Client from '../../../src/adb/client.js';
import Socket from '../../../src/adb/tcpusb/socket.js';
import SocketOptions from '../../../src/models/SocketOptions.js';
import MockDuplex from '../../mock/duplex.js';

class MockNetSocket extends MockDuplex {
  public remoteAddress = '127.0.0.1';
  public noDelay = false;

  setNoDelay(noDelay = true): this {
    this.noDelay = noDelay;
    return this;
  }
}

describe('tcpusb.Socket', () => {
  const mockClient = {} as Client;

  it('should not mutate caller-supplied SocketOptions when auth is omitted or undefined', async () => {
    const emptyOpts: SocketOptions = {};
    const s1 = new Socket(mockClient, 'serial-1', new MockNetSocket() as unknown as Net.Socket, emptyOpts);
    expect(emptyOpts).to.deep.equal({});
    expect('auth' in emptyOpts).to.equal(false);
    s1.end();

    const undefAuthOpts: SocketOptions = { auth: undefined, knownPublicKeys: [] };
    const s2 = new Socket(mockClient, 'serial-1', new MockNetSocket() as unknown as Net.Socket, undefAuthOpts);
    expect(undefAuthOpts.auth).to.equal(undefined);
    const internalAuth = (s2 as unknown as { options: SocketOptions }).options.auth;
    expect(internalAuth).to.be.a('function');
    expect(await internalAuth?.({} as never)).to.equal(true);
    s2.end();
  });

  it('should preserve caller-supplied auth handler without mutating options', () => {
    const customAuth = async () => true;
    const opts: SocketOptions = { auth: customAuth };
    const s = new Socket(mockClient, 'serial-1', new MockNetSocket() as unknown as Net.Socket, opts);
    expect(opts.auth).to.equal(customAuth);
    expect((s as unknown as { options: SocketOptions }).options.auth).to.equal(customAuth);
    s.end();
  });
});
