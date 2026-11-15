import { expect } from 'chai';
import { PassThrough } from 'node:stream';
import Service from '../../../src/adb/tcpusb/service.js';
import Packet from '../../../src/adb/tcpusb/packet.js';
import Protocol from '../../../src/adb/protocol.js';
import type Client from '../../../src/adb/client.js';
import type Socket from '../../../src/adb/tcpusb/socket.js';

const packet = (command: number, data?: string) => new Packet(command, 7, 9, data?.length ?? 0, 0, 0, data === undefined ? undefined : Buffer.from(data));

describe('tcpusb.Service', () => {
  it('opens a service, forwards data with acknowledgements and closes once', async () => {
    const source = new PassThrough();
    const writes: Buffer[] = [];
    const forwarded: Buffer[] = [];
    let ends = 0;
    const transport = {
      socket: source,
      parser: { readCode: async (code: string) => { expect(code).to.equal(Protocol.OKAY); } },
      write: async (data: Buffer) => { forwarded.push(data); },
      end: () => { ends++; },
    };
    const client = { getDevice: () => ({ transport: async () => transport }) } as unknown as Client;
    const socket = { maxPayload: 4096, write: (data: Buffer) => { writes.push(data); return true; } } as unknown as Socket;
    const service = new Service(client, 'serial', 1, 2, socket);
    let endEvents = 0;
    service.on('end', () => { endEvents++; });
    expect(await service.handle(packet(Packet.A_OPEN, 'shell:echo\0'))).to.equal(true);
    expect(forwarded[0]).to.deep.equal(Protocol.encodeData('shell:echo'));
    expect(writes[0].readUInt32LE(0)).to.equal(Packet.A_OKAY);
    expect(await service.handle(packet(Packet.A_WRTE, 'input'))).to.equal(true);
    expect(forwarded[1].toString()).to.equal('input');
    source.write('response');
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(writes.at(-1)!.readUInt32LE(0)).to.equal(Packet.A_WRTE);
    expect(writes.at(-1)!.subarray(24).toString()).to.equal('response');
    expect(await service.handle(packet(Packet.A_OKAY))).to.equal(true);
    expect(await service.handle(packet(Packet.A_CLSE))).to.equal(true);
    service.end();
    expect(ends).to.equal(1);
    expect(endEvents).to.equal(1);
    expect(writes.at(-1)!.readUInt32LE(0)).to.equal(Packet.A_CLSE);
    source.destroy();
  });

  it('rejects premature packets and reports a failed open', async () => {
    const writes: Buffer[] = [];
    const socket = { write: (data: Buffer) => { writes.push(data); return true; } } as unknown as Socket;
    const service = new Service({} as Client, 'serial', 3, 4, socket);
    let error: Error | undefined;
    service.on('error', err => { error = err; });
    expect(await service.handle(packet(Packet.A_WRTE, 'too early'))).to.equal(false);
    expect(error).to.be.instanceOf(Service.PrematurePacketError);
    expect(writes[0].readUInt32LE(0)).to.equal(Packet.A_CLSE);
    expect(writes[0].readUInt32LE(4)).to.equal(0);
  });

  it('closes a transport that arrives after the service has ended', async () => {
    let resolve!: (value: { end: () => void }) => void;
    let closed = false;
    const client = { getDevice: () => ({ transport: () => new Promise(r => { resolve = r; }) }) } as unknown as Client;
    const socket = { write: () => true } as unknown as Socket;
    const service = new Service(client, 'serial', 1, 2, socket);
    let error: Error | undefined;
    service.on('error', err => { error = err; });
    const opening = service.handle(packet(Packet.A_OPEN, 'shell:\0'));
    service.end();
    resolve({ end: () => { closed = true; } });
    expect(await opening).to.equal(false);
    expect(closed).to.equal(true);
    expect(error).to.be.instanceOf(Service.LateTransportError);
  });
});
