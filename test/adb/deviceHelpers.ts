import { expect } from 'chai';
import { mapVideoMimeToCodec, parseMediaCodecsEncoders } from '../../src/adb/DeviceMedia.js';
import { isNoUserOptionError, parseIpAddresses } from '../../src/adb/DeviceHelpers.js';

describe('DeviceClient extracted helpers', () => {
  it('mapVideoMimeToCodec should map known video MIME types', () => {
    expect(mapVideoMimeToCodec('video/avc')).to.equal('h264');
    expect(mapVideoMimeToCodec('video/hevc')).to.equal('h265');
    expect(mapVideoMimeToCodec('video/av01')).to.equal('av1');
    expect(mapVideoMimeToCodec('video/x-vnd.on2.vp8')).to.equal('vp8');
    expect(mapVideoMimeToCodec('video/x-vnd.on2.vp9')).to.equal('vp9');
    expect(mapVideoMimeToCodec('video/other')).to.equal('unknown');
  });

  it('parseMediaCodecsEncoders should parse XML encoders cleanly', () => {
    const xml = `<MediaCodecs><Encoders><MediaCodec name="c2.android.avc.encoder" type="video/avc" /></Encoders></MediaCodecs>`;
    expect(parseMediaCodecsEncoders(xml)).to.deep.equal([
      { name: 'c2.android.avc.encoder', codec: 'h264' },
    ]);
  });

  it('parseIpAddresses should extract IPv4 before IPv6 addresses', () => {
    const out = 'inet 10.0.0.2/24 brd 10.0.0.255 scope global wlan0\ninet6 fe80::abcd/64 scope link\n';
    expect(parseIpAddresses(out)).to.deep.equal(['10.0.0.2', 'fe80::abcd']);
  });

  it('isNoUserOptionError should detect --user errors safely', () => {
    expect(isNoUserOptionError(new Error('Unknown option: --user'))).to.be.true;
    expect(isNoUserOptionError(new Error('Other error'))).to.be.false;
    expect(isNoUserOptionError('Unknown option: --user')).to.be.false;
  });
});
