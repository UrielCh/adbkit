import { expect } from 'chai';
import sinon from 'sinon';
import Packet from '../../../src/adb/tcpusb/packet.js';
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

describe('tcpusb.Socket packet handling', () => {
  const packet = (command: number, arg0 = 0, arg1 = 0, data?: Buffer) =>
    new Packet(command, arg0, arg1, data?.length ?? 0, 0, 0, data);

  it('challenges a connection and accepts a signature from a known key', async () => {
    const wire = new MockNetSocket();
    const packets: Buffer[] = [];
    wire.on('write', (data: Buffer) => packets.push(data));
    const verify = sinon.stub().returns(true);
    const client = { getDevice: () => ({ getProperties: async () => ({
      'ro.product.name': 'phone', 'ro.product.model': 'model', 'ro.product.device': 'device',
    }) }) } as unknown as Client;
    const socket = new Socket(client, 'serial', wire as unknown as Net.Socket, { knownPublicKeys: [{ verify } as never] });
    await socket['_handle'](packet(Packet.A_CNXN, Packet.swap32(0x01000000), 100000));
    expect(socket.maxPayload).to.equal(65535);
    expect(packets[0].readUInt32LE(0)).to.equal(Packet.A_AUTH);
    expect(packets[0].subarray(24)).to.have.length(20);
    await socket['_handle'](packet(Packet.A_AUTH, 2, 0, Buffer.from('signature')));
    expect(verify.calledOnce).to.equal(true);
    expect(packets[1].readUInt32LE(0)).to.equal(Packet.A_CNXN);
    expect(packets[1].subarray(24).toString()).to.include('ro.product.model=model;');
    socket.end();
  });

  it('closes unauthorized service requests and handles unknown commands', async () => {
    for (const command of [Packet.A_OPEN, 0x12345678]) {
      const wire = new MockNetSocket();
      const socket = new Socket({} as Client, 'serial', wire as unknown as Net.Socket);
      const errors: Error[] = [];
      socket.on('error', error => { errors.push(error); });
      expect(await socket['_handle'](packet(command, 1, 0, Buffer.from('shell:\0')))).to.equal(false);
      expect(wire.writableEnded).to.equal(true);
      if (command === Packet.A_OPEN) expect(errors).to.have.length(0);
      else expect(errors[0].message).to.include('Unknown command');
      expect(socket.write('after end')).to.equal(false);
    }
  });
});
