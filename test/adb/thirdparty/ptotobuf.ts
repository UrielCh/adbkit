import STFServiceBuf from "../../../src/adb/thirdparty/STFService/STFServiceBuf.js";

describe('Protobuff', () => {
    it("test Protobuff encode / decode", async () => {
        // const encoded = '0610111a020800';
        // const proto = await STFProtoBuf.get();
        // const tert: Envelope = { type: MessageType.EVENT_ROTATION, message: Buffer.from('CAA=', 'base64')};
        // const buf = proto.write.Envelope(tert);
        // expect(buf.toString('hex')).to.be.eq(encoded);
        // const envelop = proto.readEnvelope(buf);
        // expect(envelop.toJSON().message).to.be.eq('CAA=');
        // const data2 = proto.read.RotationEvent(envelop.message);
        // expect(data2.rotation).to.be.eq(0);
    });

    it("parse GetVersionResponse enveloppe", async () => {
        // const encoded = '0908011205322e342e39';
        // const proto = await STFServiceBuf.get();
        // const env = proto.readEnvelopeDelimited(Buffer.from(encoded, 'hex'));
        // console.log(env);
        //const proto = await STFProtoBuf.get();


        // const tert: Envelope = { type: MessageType.EVENT_ROTATION, message: Buffer.from('CAA=', 'base64')};
        // const buf = proto.write.Envelope(tert);
        // expect(buf.toString('hex')).to.be.eq(encoded);
        // const envelop = proto.readEnvelope(buf);
        // expect(envelop.toJSON().message).to.be.eq('CAA=');
        // const data2 = proto.read.RotationEvent(envelop.message);
        // expect(data2.rotation).to.be.eq(0);
    });
    

})