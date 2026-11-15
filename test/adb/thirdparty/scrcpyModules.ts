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
import { parse_sequence_parameter_set } from '../../../src/adb/thirdparty/scrcpy/sps.js';
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

  describe('H.264 SPS High Profile parser', () => {
    class SpsBitWriter {
      private bits: number[] = [];

      writeBit(b: number): void {
        this.bits.push(b & 1);
      }

      writeBits(val: number, len: number): void {
        for (let i = len - 1; i >= 0; i--) {
          this.writeBit((val >> i) & 1);
        }
      }

      writeUE(v: number): void {
        const val = v + 1;
        const len = Math.floor(Math.log2(val));
        for (let i = 0; i < len; i++) this.writeBit(0);
        this.writeBits(val, len + 1);
      }

      writeSE(v: number): void {
        const codeNum = v <= 0 ? -2 * v : 2 * v - 1;
        this.writeUE(codeNum);
      }

      toAnnexBNalu(): Uint8Array {
        // RBSP trailing bits
        this.writeBit(1);
        while (this.bits.length % 8 !== 0) {
          this.writeBit(0);
        }
        const raw: number[] = [];
        for (let i = 0; i < this.bits.length; i += 8) {
          let byte = 0;
          for (let j = 0; j < 8; j++) {
            byte = (byte << 1) | this.bits[i + j];
          }
          raw.push(byte);
        }
        // Escape emulation prevention bytes
        const escaped: number[] = [0x00, 0x00, 0x00, 0x01];
        let zeros = 0;
        for (const byte of raw) {
          if (zeros === 2 && byte <= 0x03) {
            escaped.push(0x03);
            zeros = 0;
          }
          escaped.push(byte);
          zeros = byte === 0 ? zeros + 1 : 0;
        }
        return new Uint8Array(escaped);
      }
    }

    it('should parse High Profile SPS with seq_scaling_matrix_present_flag=1 without bit misalignment', () => {
      const w = new SpsBitWriter();
      // NALU header: forbidden_zero_bit=0, nal_ref_idc=3, nal_unit_type=7 (SPS)
      w.writeBit(0);
      w.writeBits(3, 2);
      w.writeBits(7, 5);
      // profile_idc=100 (High), constraint_set=0, level_idc=41
      w.writeBits(100, 8);
      w.writeBits(0, 8);
      w.writeBits(41, 8);
      w.writeUE(0); // seq_parameter_set_id
      w.writeUE(1); // chroma_format_idc = 1 (4:2:0)
      w.writeUE(0); // bit_depth_luma_minus8
      w.writeUE(0); // bit_depth_chroma_minus8
      w.writeBit(0); // qpprime_y_zero_transform_bypass_flag
      w.writeBit(1); // seq_scaling_matrix_present_flag = 1

      // 8 scaling lists (chroma_format_idc !== 3):
      // i=0: present=1, delta_scale=-8 -> nextScale=0 (use default shortcut, 1 se(v) only)
      w.writeBit(1);
      w.writeSE(-8);
      // i=1..2: present=0
      w.writeBit(0);
      w.writeBit(0);
      // i=3: present=1, 16 explicit entries (4x4): first=+8 (16), rest=0 (15 times)
      w.writeBit(1);
      w.writeSE(8);
      for (let k = 1; k < 16; k++) w.writeSE(0);
      // i=4..5: present=0
      w.writeBit(0);
      w.writeBit(0);
      // i=6: present=1, 8x8 list stopping early at j=2 (j=0: +4 -> 12, j=1: +4 -> 16, j=2: -16 -> 0)
      w.writeBit(1);
      w.writeSE(4);
      w.writeSE(4);
      w.writeSE(-16);
      // i=7: present=0
      w.writeBit(0);

      w.writeUE(0); // log2_max_frame_num_minus4
      w.writeUE(0); // pic_order_cnt_type = 0
      w.writeUE(2); // log2_max_pic_order_cnt_lsb_minus4
      w.writeUE(2); // max_num_ref_frames
      w.writeBit(0); // gaps_in_frame_num_value_allowed_flag
      w.writeUE(119); // pic_width_in_mbs_minus1 -> 120 * 16 = 1920
      w.writeUE(67); // pic_height_in_map_units_minus1 -> 68 * 16 = 1088
      w.writeBit(1); // frame_mbs_only_flag = 1
      w.writeBit(1); // direct_8x8_inference_flag = 1
      w.writeBit(1); // frame_cropping_flag = 1
      w.writeUE(0); // frame_crop_left_offset
      w.writeUE(0); // frame_crop_right_offset
      w.writeUE(0); // frame_crop_top_offset
      w.writeUE(4); // frame_crop_bottom_offset -> 4 * 2 = 8 -> 1088 - 8 = 1080
      w.writeBit(0); // vui_parameters_present_flag = 0

      const nalu = w.toAnnexBNalu();
      const sps = parse_sequence_parameter_set(nalu, 'H264');
      expect(sps.profile_idc).to.equal(100);
      expect(sps.pic_width_in_mbs_minus1).to.equal(119);
      expect(sps.pic_height_in_map_units_minus1).to.equal(67);
      expect(sps.frame_mbs_only_flag).to.equal(1);
      expect(sps.frame_cropping_flag).to.equal(true);
      expect(sps.frame_crop_bottom_offset).to.equal(4);

      const conf = parseVideoConfigPacket(nalu, 'H264', 0, 0);
      expect(conf.encodedWidth).to.equal(1920);
      expect(conf.encodedHeight).to.equal(1088);
      expect(conf.croppedWidth).to.equal(1920);
      expect(conf.croppedHeight).to.equal(1080);
    });

    it('should parse High 4:4:4 Profile SPS (chroma_format_idc=3) with 12 scaling lists', () => {
      const w = new SpsBitWriter();
      w.writeBit(0);
      w.writeBits(3, 2);
      w.writeBits(7, 5);
      w.writeBits(244, 8); // High 4:4:4 Predictive
      w.writeBits(0, 8);
      w.writeBits(41, 8);
      w.writeUE(0); // seq_parameter_set_id
      w.writeUE(3); // chroma_format_idc = 3
      w.writeBit(0); // separate_colour_plane_flag
      w.writeUE(0); // bit_depth_luma_minus8
      w.writeUE(0); // bit_depth_chroma_minus8
      w.writeBit(0); // qpprime_y_zero_transform_bypass_flag
      w.writeBit(1); // seq_scaling_matrix_present_flag = 1

      // 12 scaling lists when chroma_format_idc === 3
      for (let i = 0; i < 12; i++) {
        if (i === 11) {
          w.writeBit(1); // full 64-entry 8x8 list on the 12th list
          for (let k = 0; k < 64; k++) w.writeSE(0);
        } else {
          w.writeBit(0);
        }
      }

      w.writeUE(0); // log2_max_frame_num_minus4
      w.writeUE(0); // pic_order_cnt_type = 0
      w.writeUE(0); // log2_max_pic_order_cnt_lsb_minus4
      w.writeUE(1); // max_num_ref_frames
      w.writeBit(0); // gaps_in_frame_num_value_allowed_flag
      w.writeUE(79); // pic_width_in_mbs_minus1 -> 80 * 16 = 1280
      w.writeUE(44); // pic_height_in_map_units_minus1 -> 45 * 16 = 720
      w.writeBit(1); // frame_mbs_only_flag
      w.writeBit(1); // direct_8x8_inference_flag
      w.writeBit(0); // frame_cropping_flag
      w.writeBit(0); // vui_parameters_present_flag

      const sps = parse_sequence_parameter_set(w.toAnnexBNalu(), 'H264');
      expect(sps.profile_idc).to.equal(244);
      expect(sps.pic_width_in_mbs_minus1).to.equal(79);
      expect(sps.pic_height_in_map_units_minus1).to.equal(44);
      expect(sps.vui_parameters_present_flag).to.equal(false);
    });

    it('should parse VUI parameters (SAR, colorimetry, timing_info, HRD, and bitstream restriction)', () => {
      const w = new SpsBitWriter();
      // NALU header: forbidden=0, nal_ref_idc=3, nal_unit_type=7 (SPS)
      w.writeBit(0);
      w.writeBits(3, 2);
      w.writeBits(7, 5);
      // Baseline profile (66), constraint_set=0, level=31
      w.writeBits(66, 8);
      w.writeBits(0, 8);
      w.writeBits(31, 8);
      w.writeUE(0); // seq_parameter_set_id
      w.writeUE(0); // log2_max_frame_num_minus4
      w.writeUE(0); // pic_order_cnt_type
      w.writeUE(0); // log2_max_pic_order_cnt_lsb_minus4
      w.writeUE(1); // max_num_ref_frames
      w.writeBit(0); // gaps_in_frame_num_value_allowed_flag
      w.writeUE(79); // pic_width_in_mbs_minus1 -> 1280
      w.writeUE(44); // pic_height_in_map_units_minus1 -> 720
      w.writeBit(1); // frame_mbs_only_flag
      w.writeBit(1); // direct_8x8_inference_flag
      w.writeBit(0); // frame_cropping_flag
      w.writeBit(1); // vui_parameters_present_flag = 1

      // aspect_ratio_info_present_flag = 1, Extended_SAR (255), 16:9
      w.writeBit(1);
      w.writeBits(255, 8);
      w.writeBits(16, 16);
      w.writeBits(9, 16);
      // overscan_info_present_flag = 1, overscan_appropriate_flag = 0
      w.writeBit(1);
      w.writeBit(0);
      // video_signal_type_present_flag = 1, format=5 (unspecified), full_range=1, colour_description=1 (BT.709: 1,1,1)
      w.writeBit(1);
      w.writeBits(5, 3);
      w.writeBit(1);
      w.writeBit(1);
      w.writeBits(1, 8);
      w.writeBits(1, 8);
      w.writeBits(1, 8);
      // chroma_loc_info_present_flag = 1 (top=0, bottom=0)
      w.writeBit(1);
      w.writeUE(0);
      w.writeUE(0);
      // timing_info_present_flag = 1: num_units_in_tick=1001, time_scale=60000, fixed_frame_rate_flag=1 (~29.97 fps)
      w.writeBit(1);
      w.writeBits(1001, 32);
      w.writeBits(60000, 32);
      w.writeBit(1);
      // nal_hrd_parameters_present_flag = 1 (cpb_cnt_minus1 = 0 -> 1 entry)
      w.writeBit(1);
      w.writeUE(0);
      w.writeBits(4, 4); // bit_rate_scale
      w.writeBits(4, 4); // cpb_size_scale
      w.writeUE(100); // bit_rate_value_minus1
      w.writeUE(200); // cpb_size_value_minus1
      w.writeBit(1); // cbr_flag
      w.writeBits(23, 5); // initial_cpb_removal_delay_length_minus1
      w.writeBits(23, 5); // cpb_removal_delay_length_minus1
      w.writeBits(23, 5); // dpb_output_delay_length_minus1
      w.writeBits(24, 5); // time_offset_length
      // vcl_hrd_parameters_present_flag = 0
      w.writeBit(0);
      // low_delay_hrd_flag = 0 (present because nal_hrd=1)
      w.writeBit(0);
      // pic_struct_present_flag = 1
      w.writeBit(1);
      // bitstream_restriction_flag = 1
      w.writeBit(1);
      w.writeBit(1); // motion_vectors_over_pic_boundaries_flag
      w.writeUE(0); // max_bytes_per_pic_denom
      w.writeUE(0); // max_bits_per_mb_denom
      w.writeUE(11); // log2_max_mv_length_horizontal
      w.writeUE(11); // log2_max_mv_length_vertical
      w.writeUE(0); // max_num_reorder_frames
      w.writeUE(1); // max_dec_frame_buffering

      const nalu = w.toAnnexBNalu();
      const sps = parse_sequence_parameter_set(nalu, 'H264');
      expect(sps.vui_parameters_present_flag).to.equal(true);
      expect(sps.vui_parameters?.aspect_ratio_idc).to.equal(255);
      expect(sps.vui_parameters?.sar_width).to.equal(16);
      expect(sps.vui_parameters?.sar_height).to.equal(9);
      expect(sps.vui_parameters?.colour_primaries).to.equal(1);
      expect(sps.vui_parameters?.num_units_in_tick).to.equal(1001);
      expect(sps.vui_parameters?.time_scale).to.equal(60000);
      expect(sps.vui_parameters?.fixed_frame_rate_flag).to.equal(true);
      expect(sps.vui_parameters?.nal_hrd_parameters?.sched_sel).to.have.lengthOf(1);
      expect(sps.vui_parameters?.max_dec_frame_buffering).to.equal(1);

      const conf = parseVideoConfigPacket(nalu, 'H264', 0, 0);
      expect(conf.aspectRatio).to.deep.equal({ width: 16, height: 9 });
      expect(conf.frameRate).to.be.closeTo(60000 / 2002, 0.0001);
      expect(conf.colorimetry).to.deep.equal({
        videoFormat: 5,
        fullRange: true,
        colourPrimaries: 1,
        transferCharacteristics: 1,
        matrixCoefficients: 1,
      });
    });

    it('should parse unsigned 32-bit VUI timing values with MSB set and Table E-1 SAR', () => {
      const w = new SpsBitWriter();
      w.writeBit(0);
      w.writeBits(3, 2);
      w.writeBits(7, 5);
      w.writeBits(66, 8);
      w.writeBits(0, 8);
      w.writeBits(31, 8);
      w.writeUE(0);
      w.writeUE(0);
      w.writeUE(0);
      w.writeUE(0);
      w.writeUE(1);
      w.writeBit(0);
      w.writeUE(39);
      w.writeUE(29);
      w.writeBit(1);
      w.writeBit(1);
      w.writeBit(0);
      w.writeBit(1); // vui_parameters_present_flag = 1

      // aspect_ratio_info_present_flag = 1, idc = 14 (4:3)
      w.writeBit(1);
      w.writeBits(14, 8);
      // overscan, video_signal_type, chroma_loc = 0
      w.writeBit(0);
      w.writeBit(0);
      w.writeBit(0);
      // timing_info_present_flag = 1 with MSB=1 in time_scale (0x80000000)
      w.writeBit(1);
      w.writeBits(1, 32);
      w.writeBits(0x80000000, 32);
      w.writeBit(0);
      // nal_hrd, vcl_hrd, pic_struct, bitstream_restriction = 0
      w.writeBit(0);
      w.writeBit(0);
      w.writeBit(0);
      w.writeBit(0);

      const nalu = w.toAnnexBNalu();
      const sps = parse_sequence_parameter_set(nalu, 'H264');
      expect(sps.vui_parameters?.time_scale).to.equal(0x80000000);
      const conf = parseVideoConfigPacket(nalu, 'H264', 0, 0);
      expect(conf.aspectRatio).to.deep.equal({ width: 4, height: 3 });
      expect(conf.frameRate).to.equal(0x80000000 / 2);
    });
  });
});
