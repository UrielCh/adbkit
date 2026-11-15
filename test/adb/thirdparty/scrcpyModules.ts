import { expect } from 'chai';
import { PassThrough } from 'node:stream';
import PromiseDuplex from 'promise-duplex';
import { KeyCodesMap } from '../../../src/adb/keycode.js';
import { ControlMessageMap, MotionEventMap, SurfaceControlMap, codexMap } from '../../../src/adb/thirdparty/scrcpy/ScrcpyConst.js';
import {
  buildBackOrScreenOnMessage,
  buildKeycodeMessage,
  buildResizeDisplayMessage,
  buildScrollEventMessage,
  buildSetCameraTorchMessage,
  buildSetClipboardMessage,
  buildSetScreenPowerModeMessage,
  buildSimpleControlMessage,
  buildStringControlMessage,
  buildTouchEventMessage,
} from '../../../src/adb/thirdparty/scrcpy/ScrcpyControlWriter.js';
import { mapScrcpyCodec, parseVideoConfigPacket, readDeviceMessage } from '../../../src/adb/thirdparty/scrcpy/ScrcpyProtocol.js';
import { buildScrcpyStartupLine, parseScrcpyVersionParts, shellEscapeArg } from '../../../src/adb/thirdparty/scrcpy/ScrcpyStartupArgs.js';

describe('Scrcpy decomposed modules', () => {
  describe('ScrcpyStartupArgs', () => {
    it('parseScrcpyVersionParts should parse standard and non-numeric strings cleanly', () => {
      expect(parseScrcpyVersionParts('v5.0.1')).to.deep.equal({
        major: 5,
        minor: 0,
        patch: 1,
        strVersion: '05.00.01',
      });
      expect(parseScrcpyVersionParts('3')).to.deep.equal({
        major: 3,
        minor: 0,
        patch: 0,
        strVersion: '03.00.00',
      });
    });

    it('shellEscapeArg should quote empty and unsafe arguments', () => {
      expect(shellEscapeArg('')).to.equal("''");
      expect(shellEscapeArg('simple_arg-1')).to.equal('simple_arg-1');
      expect(shellEscapeArg("a 'b'")).to.equal("'a '\"'\"'b'\"'\"''");
    });

    it('buildScrcpyStartupLine should produce valid command lines directly', () => {
      const versionInfo = parseScrcpyVersionParts('4.1');
      const line = buildScrcpyStartupLine(
        {
          scid: '12345678',
          noAudio: true,
          version: '4.1',
          maxSize: 800,
          maxFps: 60,
          flip: false,
          bitrate: 4000000,
          lockedVideoOrientation: -1,
          tunnelForward: true,
          tunnelDelay: 1000,
          crop: '',
          sendFrameMeta: true,
          control: true,
          displayId: 0,
          showTouches: false,
          stayAwake: true,
          codecOptions: '',
          encoderName: '',
          powerOffScreenOnClose: false,
        },
        versionInfo,
        '/data/local/tmp/scrcpy.jar',
      );
      expect(line).to.include('CLASSPATH=/data/local/tmp/scrcpy.jar app_process / com.genymobile.scrcpy.Server 4.1 scid=12345678');
    });
  });

  describe('ScrcpyControlWriter', () => {
    it('should serialize keycode, text, touch, scroll, clipboard, power, torch, and resize messages', () => {
      const keyBuf = buildKeycodeMessage(MotionEventMap.ACTION_DOWN, KeyCodesMap.KEYCODE_HOME, 0, 0);
      expect(keyBuf.readUInt8(0)).to.equal(ControlMessageMap.TYPE_INJECT_KEYCODE);
      expect(keyBuf.readUInt32BE(2)).to.equal(KeyCodesMap.KEYCODE_HOME);

      const textBuf = buildStringControlMessage(ControlMessageMap.TYPE_INJECT_TEXT, 'hi');
      expect(textBuf.readUInt8(0)).to.equal(ControlMessageMap.TYPE_INJECT_TEXT);
      expect(textBuf.subarray(5).toString('utf8')).to.equal('hi');

      const touchV2 = buildTouchEventMessage(2, MotionEventMap.ACTION_DOWN, 1n, { x: 10, y: 20 }, { x: 100, y: 200 });
      expect(touchV2.length).to.equal(32);
      const touchV1 = buildTouchEventMessage(1, MotionEventMap.ACTION_UP, 1n, { x: 10, y: 20 }, { x: 100, y: 200 });
      expect(touchV1.length).to.equal(28);

      const scrollBuf = buildScrollEventMessage({ x: 10, y: 20 }, { x: 100, y: 200 }, 1, -2);
      expect(scrollBuf.readUInt8(0)).to.equal(ControlMessageMap.TYPE_INJECT_SCROLL_EVENT);
      expect(scrollBuf.length).to.equal(23);
      expect(scrollBuf.readInt32BE(15)).to.equal(-2);
      expect(scrollBuf.readInt32BE(19)).to.equal(MotionEventMap.BUTTON_PRIMARY);

      expect(buildBackOrScreenOnMessage()).to.deep.equal(Buffer.from([ControlMessageMap.TYPE_BACK_OR_SCREEN_ON, MotionEventMap.ACTION_UP]));
      expect(buildSimpleControlMessage(ControlMessageMap.TYPE_ROTATE_DEVICE)).to.deep.equal(Buffer.from([ControlMessageMap.TYPE_ROTATE_DEVICE]));

      const clipBuf = buildSetClipboardMessage('abc');
      expect(clipBuf.readUInt8(0)).to.equal(ControlMessageMap.TYPE_SET_CLIPBOARD);
      expect(clipBuf.readUInt8(1)).to.equal(1);

      expect(buildSetScreenPowerModeMessage(3, SurfaceControlMap.POWER_MODE_NORMAL)).to.deep.equal(Buffer.from([10, 1]));
      expect(buildSetScreenPowerModeMessage(2, SurfaceControlMap.POWER_MODE_NORMAL)).to.deep.equal(Buffer.from([10, 2]));
      expect(buildSetCameraTorchMessage(true)).to.deep.equal(Buffer.from([18, 1]));
      expect(buildResizeDisplayMessage(800, 600).readUInt16BE(1)).to.equal(800);
    });
  });

  describe('ScrcpyProtocol', () => {
    it('mapScrcpyCodec should map known codec IDs and return UNKNOWN for unknown IDs', () => {
      expect(mapScrcpyCodec(codexMap.H264)).to.equal('H264');
      expect(mapScrcpyCodec(codexMap.H265)).to.equal('H265');
      expect(mapScrcpyCodec(codexMap.AV1)).to.equal('AV1');
      expect(mapScrcpyCodec(codexMap.VP8)).to.equal('VP8');
      expect(mapScrcpyCodec(codexMap.VP9)).to.equal('VP9');
      expect(mapScrcpyCodec(0xdeadbeef)).to.equal('UNKNOWN');
    });

    it('parseVideoConfigPacket should fall back to given dimensions for non-H264 codecs', () => {
      const payload = new Uint8Array([1, 2, 3, 4]);
      const conf = parseVideoConfigPacket(payload, 'H265', 1080, 1920);
      expect(conf.encodedWidth).to.equal(1080);
      expect(conf.encodedHeight).to.equal(1920);
      expect(conf.data).to.equal(payload);
    });

    it('readDeviceMessage should decode clipboard messages and reject unknown types', async () => {
      const stream = new PassThrough();
      const duplex = new PromiseDuplex(stream);
      const text = 'hello clipboard';
      const payload = Buffer.alloc(1 + 4 + text.length);
      payload.writeUInt8(0, 0);
      payload.writeUInt32BE(text.length, 1);
      payload.write(text, 5, 'utf8');
      stream.write(payload);
      expect(await readDeviceMessage(duplex)).to.equal(text);

      stream.write(Buffer.from([99]));
      let err: unknown;
      try {
        await readDeviceMessage(duplex);
      } catch (e) {
        err = e;
      }
      expect(err).to.be.instanceOf(Error);
      expect((err as Error).message).to.include('Unsupported message type:99');
    });
  });
});
