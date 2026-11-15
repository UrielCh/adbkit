import { expect } from 'chai';
import { PassThrough, Readable } from 'node:stream';
import PromiseDuplex from 'promise-duplex';
import Sinon from 'sinon';
import Client from '../../src/adb/client.js';
import DeviceClient from '../../src/adb/DeviceClient.js';
import DevicePackage from '../../src/adb/DevicePackage.js';
import PushTransfer from '../../src/adb/sync/pushtransfer.js';
import FramebufferStreamWithMeta from '../../src/models/FramebufferStreamWithMeta.js';
import MockConnection from '../mock/connection.js';
import Protocol from '../../src/adb/protocol.js';

const mockClient = {} as Client;

const setExecOut = (device: DeviceClient, fn: () => Promise<string>): void => {
  (device as unknown as { execOut: () => Promise<string> }).execOut = fn;
};

describe('DeviceClient.listVideoEncoders', () => {
  const createClientWithXml = (xmlOutput: string): DeviceClient => {
    const client = new DeviceClient(mockClient, 'dummy-serial');
    setExecOut(client, async () => xmlOutput);
    return client;
  };

  it('should return only video encoders from <Encoders> and exclude <Decoders>', async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<MediaCodecs>
  <Decoders>
    <MediaCodec name="OMX.qcom.video.decoder.avc" type="video/avc" />
    <MediaCodec name="c2.android.hevc.decoder" type="video/hevc" />
  </Decoders>
  <Encoders>
    <MediaCodec name="OMX.qcom.video.encoder.avc" type="video/avc" />
    <MediaCodec type="video/hevc" name="c2.qti.hevc.encoder" />
    <MediaCodec name="c2.android.av1.encoder">
      <Type name="video/av01" />
    </MediaCodec>
    <MediaCodec name="c2.android.vp8.encoder" type="video/x-vnd.on2.vp8" />
    <MediaCodec name="c2.android.vp9.encoder" type="video/x-vnd.on2.vp9" />
    <MediaCodec name="c2.qti.avc.encoder.secure" type="video/avc" />
    <MediaCodec name="c2.disabled.encoder" type="video/avc" enabled="false" />
    <MediaCodec name="OMX.google.aac.encoder" type="audio/mp4a-latm" />
  </Encoders>
</MediaCodecs>
<?xml version="1.0" encoding="utf-8"?>
<MediaCodecs>
  <Encoders>
    <MediaCodec name="OMX.qcom.video.encoder.avc" type="video/avc" />
    <MediaCodec name="c2.android.avc.encoder" type="video/avc" />
  </Encoders>
</MediaCodecs>`;

    const client = createClientWithXml(xml);
    const encoders = await client.listVideoEncoders();

    expect(encoders).to.deep.equal([
      { name: 'OMX.qcom.video.encoder.avc', codec: 'h264' },
      { name: 'c2.qti.hevc.encoder', codec: 'h265' },
      { name: 'c2.android.av1.encoder', codec: 'av1' },
      { name: 'c2.android.vp8.encoder', codec: 'vp8' },
      { name: 'c2.android.vp9.encoder', codec: 'vp9' },
      { name: 'c2.android.avc.encoder', codec: 'h264' },
    ]);
  });

  it('should return an empty array if execOut throws', async () => {
    const client = new DeviceClient(mockClient, 'dummy-serial');
    setExecOut(client, async () => {
      throw new Error('adb failure');
    });

    const encoders = await client.listVideoEncoders();
    expect(encoders).to.deep.equal([]);
  });
});

describe('DeviceClient.startActivity / startService', () => {
  const createDeviceClient = (responses: Array<{ expectedCmd?: string; lines: string[] }>) => {
    let callIndex = 0;
    const device = new DeviceClient(mockClient, 'dummy-serial');
    device.transport = async () => {
      const conn = new MockConnection();
      const spec = responses[callIndex++];
      conn.getSocket().on('write', (chunk: Buffer) => {
        if (spec?.expectedCmd) {
          expect(chunk.toString()).to.equal(Protocol.encodeData(spec.expectedCmd).toString());
        }
      });
      setImmediate(() => {
        const socket = conn.getSocket();
        socket.causeRead(Protocol.OKAY);
        for (const line of spec?.lines ?? []) {
          socket.causeRead(line);
        }
        socket.causeEnd();
      });
      return conn;
    };
    return device;
  };

  it('startActivity should rethrow non-user errors without TypeError', async () => {
    const device = createDeviceClient([{ lines: ['Error: Activity not found\n'] }]);
    let caught: unknown;
    try {
      await device.startActivity({ component: 'com.example/.Main', user: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.an.instanceOf(Error);
    expect((caught as Error).message).to.equal('Activity not found');
  });

  it('startActivity should retry without user on --user error and not mutate options', async () => {
    const device = createDeviceClient([
      {
        expectedCmd: "shell:am start -n 'com.example/.Main' --user 0",
        lines: ['Error: Unknown option: --user\n'],
      },
      {
        expectedCmd: "shell:am start -n 'com.example/.Main'",
        lines: ['Success\n'],
      },
    ]);
    const options = { component: 'com.example/.Main', user: 0 };
    const result = await device.startActivity(options);
    expect(result).to.equal(true);
    expect(options.user).to.equal(0);
  });

  it('startService should default user to 0 without mutating options and retry without user on --user error', async () => {
    const device = createDeviceClient([
      {
        expectedCmd: "shell:am startservice -n 'com.example/.Svc' --user 0",
        lines: ['Error: Unknown option: --user\n'],
      },
      {
        expectedCmd: "shell:am startservice -n 'com.example/.Svc'",
        lines: ['Success\n'],
      },
    ]);
    const options: { component: string; user?: number } = { component: 'com.example/.Svc' };
    const result = await device.startService(options);
    expect(result).to.equal(true);
    expect(options.user).to.equal(undefined);
  });

  it('startService should rethrow non-user errors without TypeError', async () => {
    const device = createDeviceClient([{ lines: ['Error: Service not found\n'] }]);
    let caught: unknown;
    try {
      await device.startService({ component: 'com.example/.Svc' });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.an.instanceOf(Error);
    expect((caught as Error).message).to.equal('Service not found');
  });
});

describe('DeviceClient resource reliability', () => {
  it('screencap should close the first transport when falling back to framebuffer', async () => {
    const firstConn = new MockConnection();
    const endSpy = Sinon.spy(firstConn, 'end');
    firstConn.getSocket().on('write', () => {
      setImmediate(() => {
        const sock = firstConn.getSocket();
        sock.causeRead(Protocol.OKAY);
        sock.causeEnd(); // Triggers ScreencapCommand "No support for the screencap command"
      });
    });

    const device = new DeviceClient(mockClient, 'dummy-serial');
    device.transport = async () => firstConn;
    const fallbackStream = new PassThrough() as unknown as FramebufferStreamWithMeta;
    const framebufferStub = Sinon.stub(device, 'framebuffer').resolves(fallbackStream);

    const res = await device.screencap();
    expect(res).to.equal(fallbackStream);
    expect(endSpy.calledOnce).to.equal(true);
    expect(framebufferStub.calledOnceWithExactly('png')).to.equal(true);
  });

  it('installRemote should not mask the original install error when cleanup rm fails', async () => {
    const conn = new MockConnection();
    const endSpy = Sinon.spy(conn, 'end');
    conn.getSocket().on('write', () => {
      setImmediate(() => {
        const sock = conn.getSocket();
        sock.causeRead(Protocol.OKAY);
        sock.causeRead('Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]\n');
        sock.causeEnd();
      });
    });

    const device = new DeviceClient(mockClient, 'dummy-serial');
    device.transport = async () => conn;
    setExecOut(device, async () => {
      throw new Error('device offline during rm');
    });

    let caught: unknown;
    try {
      await device.installRemote('/data/local/tmp/app.apk');
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.an.instanceOf(Error);
    expect((caught as Error).message).to.include('INSTALL_FAILED_INSUFFICIENT_STORAGE');
    expect(endSpy.calledOnce).to.equal(true);
  });

  it('install should use distinct temp paths for concurrent stream installs', async () => {
    const device = new DeviceClient(mockClient, 'dummy-serial');
    const pushedPaths: string[] = [];
    const installedPaths: string[] = [];

    device.push = async (_stream: string | Readable, remotePath: string) => {
      pushedPaths.push(remotePath);
      return {
        waitForEnd: async () => {},
      } as unknown as PushTransfer;
    };
    device.installRemote = async (remotePath: string) => {
      installedPaths.push(remotePath);
      return true;
    };

    const s1 = new PassThrough();
    const s2 = new PassThrough();
    await Promise.all([device.install(s1), device.install(s2)]);

    expect(pushedPaths).to.have.lengthOf(2);
    expect(pushedPaths[0]).to.not.equal(pushedPaths[1]);
    expect(pushedPaths[0]).to.match(/^\/data\/local\/tmp\/_stream_[0-9a-f-]+\.apk$/);
    expect(pushedPaths[1]).to.match(/^\/data\/local\/tmp\/_stream_[0-9a-f-]+\.apk$/);
    expect(installedPaths).to.deep.equal(pushedPaths);
  });

  it('push should accept a generic Readable stream', async () => {
    const conn = new MockConnection();
    const writes: Buffer[] = [];
    conn.getSocket().on('write', (chunk: Buffer) => {
      writes.push(chunk);
    });
    setImmediate(() => {
      const sock = conn.getSocket();
      sock.causeRead(Protocol.OKAY);
      setImmediate(() => {
        sock.causeRead(Protocol.OKAY);
        sock.causeRead(Buffer.alloc(4));
        sock.causeEnd();
      });
    });

    const device = new DeviceClient(mockClient, 'dummy-serial');
    device.transport = async () => conn;

    const stream = Readable.from([Buffer.from('hello')]);
    const transfer = await device.push(stream, '/data/local/tmp/hello.txt');
    await transfer.waitForEnd();

    expect(Buffer.concat(writes).toString()).to.include('hello');
  });
});

describe('DeviceClient shell argument escaping', () => {
  const createCaptureExecDevice = (response = '') => {
    const sentCommands: string[] = [];
    const device = new DeviceClient(mockClient, 'dummy-serial');
    device.transport = async () => {
      const conn = new MockConnection();
      conn.getSocket().on('write', (chunk: Buffer) => {
        sentCommands.push(chunk.toString());
      });
      setImmediate(() => {
        const sock = conn.getSocket();
        sock.causeRead(Protocol.OKAY);
        if (response) {
          sock.causeRead(response);
        }
        sock.causeEnd();
      });
      return conn;
    };
    return { device, sentCommands };
  };

  it('getIpAddress should escape iface argument', async () => {
    const { device, sentCommands } = createCaptureExecDevice(
      'inet 192.168.1.10/24 brd 192.168.1.255 scope global wlan0\ninet6 fe80::1/64 scope link\n',
    );
    const ips = await device.getIpAddress("wlan0; rm -rf / 'test'");
    expect(ips).to.deep.equal(['192.168.1.10', 'fe80::1']);
    expect(sentCommands[0]).to.equal(
      Protocol.encodeData(`exec:'ip' 'addr' 'show' 'wlan0; rm -rf / '"'"'test'"'"''`).toString(),
    );
  });

  it('DevicePackage.dump should escape package name argument', async () => {
    const { device, sentCommands } = createCaptureExecDevice('Package [com.example]\n');
    const pkg = new DevicePackage(device, "com.example; echo 'pwn'");
    const output = await pkg.dump();
    expect(output).to.equal('Package [com.example]\n');
    expect(sentCommands[0]).to.equal(
      Protocol.encodeData(`exec:'dumpsys' 'package' 'com.example; echo '"'"'pwn'"'"''`).toString(),
    );
  });

  it('DeviceClientExtra.tap should escape tap coordinates', async () => {
    const { device, sentCommands } = createCaptureExecDevice('');
    await device.extra.tap("100; id", "200 'test'");
    expect(sentCommands[0]).to.equal(
      Protocol.encodeData(`exec:'input' 'tap' '100; id' '200 '"'"'test'"'"''`).toString(),
    );
  });
});

describe('DeviceClient.tryForwardTCP', () => {
  it('should ignore localabstract forwards on this.serial and not return NaN', async () => {
    const device = new DeviceClient(mockClient, 'serial-1');
    device.listForwards = async () => [
      { serial: 'serial-1', local: 'localabstract:existing', remote: 'localabstract:scrcpy' },
    ];
    const forwarded: Array<[string, string]> = [];
    device.forward = async (local: string, remote: string) => {
      forwarded.push([local, remote]);
      return true;
    };

    const port = await device.tryForwardTCP('localabstract:scrcpy', 27183);
    expect(port).to.equal(27183);
    expect(forwarded).to.deep.equal([['tcp:27183', 'localabstract:scrcpy']]);
  });

  it('should return existing tcp forward port on this.serial', async () => {
    const device = new DeviceClient(mockClient, 'serial-1');
    device.listForwards = async () => [
      { serial: 'serial-2', local: 'tcp:11111', remote: 'localabstract:scrcpy' },
      { serial: 'serial-1', local: 'localabstract:other', remote: 'localabstract:scrcpy' },
      { serial: 'serial-1', local: 'tcp:27185', remote: 'localabstract:scrcpy' },
    ];
    device.forward = async () => {
      throw new Error('should not create a new forward');
    };

    const port = await device.tryForwardTCP('localabstract:scrcpy', 27183);
    expect(port).to.equal(27185);
  });

  it('should allow preferedPort when another serial forwards to the same remote on a different port', async () => {
    const device = new DeviceClient(mockClient, 'serial-1');
    device.listForwards = async () => [
      { serial: 'serial-2', local: 'tcp:27184', remote: 'localabstract:scrcpy' },
    ];
    const forwarded: Array<[string, string]> = [];
    device.forward = async (local: string, remote: string) => {
      forwarded.push([local, remote]);
      return true;
    };

    const port = await device.tryForwardTCP('localabstract:scrcpy', 27183);
    expect(port).to.equal(27183);
    expect(forwarded).to.deep.equal([['tcp:27183', 'localabstract:scrcpy']]);
  });

  it('should pick a free port if preferedPort is already bound', async () => {
    const device = new DeviceClient(mockClient, 'serial-1');
    device.listForwards = async () => [
      { serial: 'serial-2', local: 'tcp:27183', remote: 'localabstract:other' },
    ];
    const forwarded: Array<[string, string]> = [];
    device.forward = async (local: string, remote: string) => {
      forwarded.push([local, remote]);
      return true;
    };

    const port = await device.tryForwardTCP('localabstract:scrcpy', 27183);
    expect(port).to.be.a('number').and.not.equal(27183);
    expect(forwarded).to.deep.equal([[`tcp:${port}`, 'localabstract:scrcpy']]);
  });
});

describe('DeviceClient API cleanup & deprecated aliases', () => {
  it('openLocal2 should delegate to openLocal and return a PromiseDuplex', async () => {
    const device = new DeviceClient(mockClient, 'dummy-serial');
    const mockStream = new PassThrough();
    const openLocalStub = Sinon.stub(device, 'openLocal').resolves(mockStream);

    const duplex = await device.openLocal2('localabstract:test', 'ctx');
    expect(openLocalStub.calledOnceWithExactly('localabstract:test')).to.equal(true);
    expect(duplex).to.be.an.instanceOf(PromiseDuplex);
    expect(duplex.stream).to.equal(mockStream);
  });

  it('DeviceClientExtra.airPlainMode should delegate to airplaneMode', async () => {
    const device = new DeviceClient(mockClient, 'dummy-serial');
    const airplaneStub = Sinon.stub(device.extra, 'airplaneMode').resolves(true);

    const res = await device.extra.airPlainMode(true, 150);
    expect(res).to.equal(true);
    expect(airplaneStub.calledOnceWithExactly(true, 150)).to.equal(true);
  });

  it('listPackages should delegate to getPackages and preserve hyphenated package names', async () => {
    const device = new DeviceClient(mockClient, 'dummy-serial');
    const getPackagesStub = Sinon.stub(device, 'getPackages').resolves([
      'com.example.app',
      'com.example.my-hyphenated-app',
    ]);

    const allPkgs = await device.listPackages();
    expect(getPackagesStub.firstCall.args).to.deep.equal([]);
    expect(allPkgs.every((p) => p instanceof DevicePackage)).to.equal(true);
    expect(allPkgs.map((p) => p.name)).to.deep.equal([
      'com.example.app',
      'com.example.my-hyphenated-app',
    ]);

    await device.listPackages({ thirdparty: true });
    expect(getPackagesStub.secondCall.args).to.deep.equal(['-3']);
  });
});
