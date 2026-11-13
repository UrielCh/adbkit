import { expect } from 'chai';
import DeviceClient from '../../src/adb/DeviceClient.js';

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
