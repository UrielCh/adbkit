import { expect } from 'chai';
import { PassThrough } from 'node:stream';
import Packet from '../../../src/adb/tcpusb/packet.js';
import PacketReader, { ChecksumError, MagicError } from '../../../src/adb/tcpusb/packetreader.js';

describe('tcpusb packet protocol', () => {
  it('round-trips fragmented packets and preserves the header and payload', async () => {
    const stream = new PassThrough();
    const reader = new PacketReader(stream);
    const packetPromise = new Promise<Packet>((resolve, reject) => reader.once('packet', resolve).once('error', reject));
    const encoded = Packet.assemble(Packet.A_WRTE, 7, 9, Buffer.from('hello'));
    stream.write(encoded.subarray(0, 11));
    stream.write(encoded.subarray(11, 25));
    stream.end(encoded.subarray(25));
    const packet = await packetPromise;
    expect(packet.toString()).to.equal('WRTE arg0=7 arg1=9 length=5');
    expect(packet.data?.toString()).to.equal('hello');
    expect(packet.verifyChecksum()).to.equal(true);
    expect(packet.verifyMagic()).to.equal(true);
  });

  for (const [offset, errorType] of [[20, MagicError], [24, ChecksumError]] as const) {
    it(`rejects a corrupted ${errorType.name}`, async () => {
      const stream = new PassThrough();
      const reader = new PacketReader(stream);
      const errorPromise = new Promise<Error>(resolve => reader.once('error', resolve));
      const data = Packet.assemble(Packet.A_WRTE, 1, 2, Buffer.from('x'));
      data[offset] ^= 0xff;
      stream.end(data);
      expect(await errorPromise).to.be.instanceOf(errorType);
    });
  }
});
