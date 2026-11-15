import { expect } from 'chai';
import Client from '../../src/adb/client.js';
import DeviceClient from '../../src/adb/DeviceClient.js';
import Protocol from '../../src/adb/protocol.js';
import MockConnection from '../mock/connection.js';

describe('Client.connect / Client.disconnect host:port parsing', () => {
  const createMockClient = (replyForWrite: (written: string) => string) => {
    const client = new Client();
    const sent: string[] = [];
    client.connection = (async () => {
      const conn = new MockConnection();
      conn.getSocket().on('write', (chunk: Buffer) => {
        const msg = chunk.toString();
        sent.push(msg);
        setImmediate(() => {
          const sock = conn.getSocket();
          sock.causeRead(Protocol.OKAY);
          sock.causeRead(Protocol.encodeData(replyForWrite(msg)));
          sock.causeEnd();
        });
      });
      return conn;
    }) as unknown as typeof client.connection;
    return { client, sent };
  };

  it('connect should handle IPv4 with and without port', async () => {
    const { client, sent } = createMockClient(() => 'connected to 192.168.1.10:5556');
    expect(await client.connect('192.168.1.10:5556')).to.equal(true);
    expect(await client.connect('192.168.1.10')).to.equal(true);
    expect(sent).to.deep.equal([
      Protocol.encodeData('host:connect:192.168.1.10:5556').toString(),
      Protocol.encodeData('host:connect:192.168.1.10:5555').toString(),
    ]);
  });

  it('connect should handle bracketed and bare IPv6 addresses', async () => {
    const { client, sent } = createMockClient(() => 'connected to [::1]:5556');
    expect(await client.connect('[::1]:5556')).to.equal(true);
    expect(await client.connect('[2001:db8::1]')).to.equal(true);
    expect(await client.connect('fe80::1', 5557)).to.equal(true);
    expect(sent).to.deep.equal([
      Protocol.encodeData('host:connect:[::1]:5556').toString(),
      Protocol.encodeData('host:connect:[2001:db8::1]:5555').toString(),
      Protocol.encodeData('host:connect:[fe80::1]:5557').toString(),
    ]);
  });

  it('disconnect should handle IPv4, bracketed IPv6, and bare IPv6 addresses', async () => {
    const { client, sent } = createMockClient(() => '');

    const d1 = await client.disconnect('192.168.1.10:5556');
    expect(d1).to.be.an.instanceOf(DeviceClient);
    expect(d1.serial).to.equal('192.168.1.10:5556');

    const d2 = await client.disconnect('[::1]:5556');
    expect(d2.serial).to.equal('[::1]:5556');

    const d3 = await client.disconnect('2001:db8::1', 5557);
    expect(d3.serial).to.equal('[2001:db8::1]:5557');

    expect(sent).to.deep.equal([
      Protocol.encodeData('host:disconnect:192.168.1.10:5556').toString(),
      Protocol.encodeData('host:disconnect:[::1]:5556').toString(),
      Protocol.encodeData('host:disconnect:[2001:db8::1]:5557').toString(),
    ]);
  });
});
