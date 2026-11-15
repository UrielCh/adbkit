import { expect } from 'chai';
import { PassThrough } from 'node:stream';
import { listDeviceVideoEncoders, mapVideoMimeToCodec, parseMediaCodecsEncoders, screencapWithFallback } from '../../src/adb/DeviceMedia.js';
import { isNoUserOptionError, parseIpAddresses, startWithUserFallback } from '../../src/adb/DeviceHelpers.js';
import { installRemoteApk } from '../../src/adb/DevicePackageHelper.js';
import MockConnection from '../mock/connection.js';
import Protocol from '../../src/adb/protocol.js';

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

  it('startWithUserFallback should apply defaultUser without mutating input and retry without user on --user error', async () => {
    const calls: Array<{ component: string; user?: number | null }> = [];
    const options: { component: string; user?: number | null } = { component: 'com.example/.Svc' };
    const result = await startWithUserFallback(options, 0, async (opts) => {
      calls.push({ ...opts });
      if (opts.user !== undefined) {
        throw new Error('Unknown option: --user');
      }
      return true;
    });
    expect(result).to.be.true;
    expect(options.user).to.equal(undefined);
    expect(calls).to.deep.equal([
      { component: 'com.example/.Svc', user: 0 },
      { component: 'com.example/.Svc', user: undefined },
    ]);
  });

  it('startWithUserFallback should not retry when user is null or error is unrelated', async () => {
    let calls = 0;
    let caught: unknown;
    try {
      await startWithUserFallback({ component: 'com.example/.Svc', user: null }, 0, async () => {
        calls++;
        throw new Error('Unknown option: --user');
      });
    } catch (err) {
      caught = err;
    }
    expect(calls).to.equal(1);
    expect((caught as Error).message).to.include('--user');
  });

  it('listDeviceVideoEncoders should return empty array when execOut rejects', async () => {
    const encoders = await listDeviceVideoEncoders(async () => {
      throw new Error('shell error');
    });
    expect(encoders).to.deep.equal([]);
  });

  it('screencapWithFallback should close failed transport and invoke fallback', async () => {
    const conn = new MockConnection();
    let ended = false;
    const origEnd = conn.end.bind(conn);
    conn.end = () => {
      ended = true;
      return origEnd();
    };
    conn.getSocket().on('write', () => {
      setImmediate(() => {
        conn.getSocket().causeRead(Protocol.OKAY);
        conn.getSocket().causeEnd();
      });
    });

    const fallbackStream = new PassThrough();
    const res = await screencapWithFallback({
      getTransport: async () => conn,
      options: { sudo: false },
      fallback: async () => fallbackStream,
      debug: () => {},
    });
    expect(res).to.equal(fallbackStream);
    expect(ended).to.be.true;
  });

  it('installRemoteApk should clean up temp apk on success', async () => {
    const conn = new MockConnection();
    conn.getSocket().on('write', () => {
      setImmediate(() => {
        conn.getSocket().causeRead(Protocol.OKAY);
        conn.getSocket().causeRead('Success\n');
        conn.getSocket().causeEnd();
      });
    });
    const rmCmds: unknown[] = [];
    const ok = await installRemoteApk({
      apk: '/data/local/tmp/test.apk',
      getTransport: async () => conn,
      options: { sudo: false },
      execOut: async (cmd) => {
        rmCmds.push(Array.from(cmd));
        return '';
      },
      debug: () => {},
    });
    expect(ok).to.be.true;
    expect(rmCmds).to.deep.equal([['rm', '-f', '/data/local/tmp/test.apk']]);
  });
});
