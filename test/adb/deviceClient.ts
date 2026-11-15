import { expect } from 'chai';
import DeviceClient from '../../src/adb/DeviceClient.js';
import MockConnection from '../mock/connection.js';
import Protocol from '../../src/adb/protocol.js';

describe('DeviceClient.listVideoEncoders', () => {
  const createClientWithXml = (xmlOutput: string): DeviceClient => {
    const client = new DeviceClient({} as any, 'dummy-serial');
    client.execOut = (async () => xmlOutput) as any;
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
    const client = new DeviceClient({} as any, 'dummy-serial');
    client.execOut = (async () => {
      throw new Error('adb failure');
    }) as any;

    const encoders = await client.listVideoEncoders();
    expect(encoders).to.deep.equal([]);
  });
});

describe('DeviceClient.startActivity / startService', () => {
  const createDeviceClient = (responses: Array<{ expectedCmd?: string; lines: string[] }>) => {
    let callIndex = 0;
    const device = new DeviceClient({} as any, 'dummy-serial');
    device.transport = (async () => {
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
    }) as any;
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
