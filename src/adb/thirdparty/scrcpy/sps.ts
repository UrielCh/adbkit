// imported from https://github.com/yume-chan/ya-webadb

export interface HrdSchedSelEntry {
  bit_rate_value_minus1: number;
  cpb_size_value_minus1: number;
  cbr_flag: boolean;
}

export interface HrdParameters {
  cpb_cnt_minus1: number;
  bit_rate_scale: number;
  cpb_size_scale: number;
  sched_sel: HrdSchedSelEntry[];
  initial_cpb_removal_delay_length_minus1: number;
  cpb_removal_delay_length_minus1: number;
  dpb_output_delay_length_minus1: number;
  time_offset_length: number;
}

export interface VuiParameters {
  aspect_ratio_info_present_flag: boolean;
  aspect_ratio_idc?: number;
  sar_width?: number;
  sar_height?: number;
  overscan_info_present_flag: boolean;
  overscan_appropriate_flag?: boolean;
  video_signal_type_present_flag: boolean;
  video_format?: number;
  video_full_range_flag?: boolean;
  colour_description_present_flag?: boolean;
  colour_primaries?: number;
  transfer_characteristics?: number;
  matrix_coefficients?: number;
  chroma_loc_info_present_flag: boolean;
  chroma_sample_loc_type_top_field?: number;
  chroma_sample_loc_type_bottom_field?: number;
  timing_info_present_flag: boolean;
  num_units_in_tick?: number;
  time_scale?: number;
  fixed_frame_rate_flag?: boolean;
  nal_hrd_parameters_present_flag: boolean;
  nal_hrd_parameters?: HrdParameters;
  vcl_hrd_parameters_present_flag: boolean;
  vcl_hrd_parameters?: HrdParameters;
  low_delay_hrd_flag?: boolean;
  pic_struct_present_flag: boolean;
  bitstream_restriction_flag: boolean;
  motion_vectors_over_pic_boundaries_flag?: boolean;
  max_bytes_per_pic_denom?: number;
  max_bits_per_mb_denom?: number;
  log2_max_mv_length_horizontal?: number;
  log2_max_mv_length_vertical?: number;
  max_num_reorder_frames?: number;
  max_dec_frame_buffering?: number;
}

export interface VuiColorimetry {
  videoFormat: number;
  fullRange: boolean;
  colourPrimaries?: number;
  transferCharacteristics?: number;
  matrixCoefficients?: number;
}

export interface ScrcpyHeader {
  profile_idc: number,
  constraint_set: number,
  constraint_set0_flag: boolean,
  constraint_set1_flag: boolean,
  constraint_set2_flag: boolean,
  constraint_set3_flag: boolean,
  constraint_set4_flag: boolean,
  constraint_set5_flag: boolean,
  level_idc: number,
  seq_parameter_set_id: number,
  pic_width_in_mbs_minus1: number,
  pic_height_in_map_units_minus1: number,
  frame_mbs_only_flag: number,
  frame_cropping_flag: boolean,
  frame_crop_left_offset: number,
  frame_crop_right_offset: number,
  frame_crop_top_offset: number,
  frame_crop_bottom_offset: number,
  vui_parameters_present_flag: boolean,
  vui_parameters?: VuiParameters,
}

class BitReader {
  private buffer: Uint8Array;

  private bytePosition = 0;

  private bitPosition = 0;

  public constructor(buffer: Uint8Array) {
    this.buffer = buffer;
  }

  public read(length: number): number {
    let result = 0;
    for (let i = 0; i < length; i += 1) {
      result = (result << 1) | this.next();
    }
    return result >>> 0;
  }

  public next(): number {
    if (this.bytePosition >= this.buffer.length) {
      throw new Error('Invalid data');
    }
    const value = (this.buffer[this.bytePosition]! >> (7 - this.bitPosition)) & 1;
    this.bitPosition += 1;
    if (this.bitPosition === 8) {
      this.bytePosition += 1;
      this.bitPosition = 0;
    }
    return value;
  }

  public decodeExponentialGolombNumber(): number {
    let length = 0;
    while (this.next() === 0) {
      length += 1;
    }
    if (length === 0) {
      return 0;
    }
    return (1 << length | this.read(length)) - 1;
  }

  public decodeSignedExponentialGolombNumber(): number {
    const codeNum = this.decodeExponentialGolombNumber();
    if (codeNum === 0) {
      return 0;
    }
    return (codeNum & 1) ? ((codeNum + 1) >> 1) : -(codeNum >> 1);
  }
}

function skipScalingList(reader: BitReader, sizeOfScalingList: number): void {
  let lastScale = 8;
  let nextScale = 8;
  for (let j = 0; j < sizeOfScalingList; j++) {
    if (nextScale !== 0) {
      const deltaScale = reader.decodeSignedExponentialGolombNumber();
      nextScale = (((lastScale + deltaScale) % 256) + 256) % 256;
    }
    lastScale = nextScale === 0 ? lastScale : nextScale;
  }
}

function* iterateNalu(buffer: Uint8Array): Generator<Uint8Array> {
  // -1 means we haven't found the first start code
  let start = -1;
  let writeIndex = 0;

  // How many `0x00`s in a row we have counted
  let zeroCount = 0;

  let inEmulation = false;

  for (const byte of buffer) {
    buffer[writeIndex] = byte;
    writeIndex += 1;

    if (inEmulation) {
      if (byte > 0x03) {
        // `0x00000304` or larger are invalid
        throw new Error('Invalid data');
      }

      inEmulation = false;
      continue;
    }

    if (byte == 0x00) {
      zeroCount += 1;
      continue;
    }

    const lastZeroCount = zeroCount;
    zeroCount = 0;

    if (start === -1) {
      // 0x000001 is the start code
      // But it can be preceded by any number of zeros
      // So 2 is the minimal
      if (lastZeroCount >= 2 && byte === 0x01) {
        // Found start of first NAL unit
        writeIndex = 0;
        start = 0;
        continue;
      }

      // Not begin with start code
      throw new Error('Invalid data');
    }

    if (lastZeroCount < 2) {
      // zero or one `0x00`s are acceptable
      continue;
    }

    if (byte === 0x01) {
      // Remove all leading `0x00`s and this `0x01`
      writeIndex -= lastZeroCount + 1;

      // Found another NAL unit
      yield buffer.subarray(start, writeIndex);

      start = writeIndex;
      continue;
    }

    if (lastZeroCount > 2) {
      // Too much `0x00`s
      throw new Error('Invalid data');
    }

    switch (byte) {
      case 0x02:
        // Didn't find why, but 7.4.1 NAL unit semantics forbids `0x000002` appearing in NAL units
        throw new Error('Invalid data');
      case 0x03:
        // `0x000003` is the "emulation_prevention_three_byte"
        // `0x00000300`, `0x00000301`, `0x00000302` and `0x00000303` represent
        // `0x000000`, `0x000001`, `0x000002` and `0x000003` respectively

        // Remove current byte
        writeIndex -= 1;

        inEmulation = true;
        break;
      default:
        // `0x000004` or larger are ok
        break;
    }
  }

  if (inEmulation || zeroCount !== 0) {
    throw new Error('Invalid data');
  }

  yield buffer.subarray(start, writeIndex);
}

const EXTENDED_SAR = 255;

const SAR_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],   // 0: Unspecified
  [1, 1],   // 1: 1:1 (square)
  [12, 11], // 2
  [10, 11], // 3
  [16, 11], // 4
  [40, 33], // 5
  [24, 11], // 6
  [20, 11], // 7
  [32, 11], // 8
  [80, 33], // 9
  [18, 11], // 10
  [15, 11], // 11
  [64, 33], // 12
  [160, 99], // 13
  [4, 3],   // 14
  [3, 2],   // 15
  [2, 1],   // 16
];

// E.1.2 HRD parameters syntax
function parseHrdParameters(reader: BitReader): HrdParameters {
  const cpb_cnt_minus1 = reader.decodeExponentialGolombNumber();
  const bit_rate_scale = reader.read(4);
  const cpb_size_scale = reader.read(4);
  const sched_sel: HrdSchedSelEntry[] = [];
  for (let schedSelIdx = 0; schedSelIdx <= cpb_cnt_minus1; schedSelIdx += 1) {
    const bit_rate_value_minus1 = reader.decodeExponentialGolombNumber();
    const cpb_size_value_minus1 = reader.decodeExponentialGolombNumber();
    const cbr_flag = !!reader.next();
    sched_sel.push({
      bit_rate_value_minus1,
      cpb_size_value_minus1,
      cbr_flag,
    });
  }
  const initial_cpb_removal_delay_length_minus1 = reader.read(5);
  const cpb_removal_delay_length_minus1 = reader.read(5);
  const dpb_output_delay_length_minus1 = reader.read(5);
  const time_offset_length = reader.read(5);
  return {
    cpb_cnt_minus1,
    bit_rate_scale,
    cpb_size_scale,
    sched_sel,
    initial_cpb_removal_delay_length_minus1,
    cpb_removal_delay_length_minus1,
    dpb_output_delay_length_minus1,
    time_offset_length,
  };
}

// E.1.1 VUI parameters syntax
function parseVuiParameters(reader: BitReader): VuiParameters {
  const vui: VuiParameters = {
    aspect_ratio_info_present_flag: !!reader.next(),
    overscan_info_present_flag: false,
    video_signal_type_present_flag: false,
    chroma_loc_info_present_flag: false,
    timing_info_present_flag: false,
    nal_hrd_parameters_present_flag: false,
    vcl_hrd_parameters_present_flag: false,
    pic_struct_present_flag: false,
    bitstream_restriction_flag: false,
  };

  if (vui.aspect_ratio_info_present_flag) {
    vui.aspect_ratio_idc = reader.read(8);
    if (vui.aspect_ratio_idc === EXTENDED_SAR) {
      vui.sar_width = reader.read(16);
      vui.sar_height = reader.read(16);
    }
  }

  vui.overscan_info_present_flag = !!reader.next();
  if (vui.overscan_info_present_flag) {
    vui.overscan_appropriate_flag = !!reader.next();
  }

  vui.video_signal_type_present_flag = !!reader.next();
  if (vui.video_signal_type_present_flag) {
    vui.video_format = reader.read(3);
    vui.video_full_range_flag = !!reader.next();
    vui.colour_description_present_flag = !!reader.next();
    if (vui.colour_description_present_flag) {
      vui.colour_primaries = reader.read(8);
      vui.transfer_characteristics = reader.read(8);
      vui.matrix_coefficients = reader.read(8);
    }
  }

  vui.chroma_loc_info_present_flag = !!reader.next();
  if (vui.chroma_loc_info_present_flag) {
    vui.chroma_sample_loc_type_top_field = reader.decodeExponentialGolombNumber();
    vui.chroma_sample_loc_type_bottom_field = reader.decodeExponentialGolombNumber();
  }

  vui.timing_info_present_flag = !!reader.next();
  if (vui.timing_info_present_flag) {
    vui.num_units_in_tick = reader.read(32);
    vui.time_scale = reader.read(32);
    vui.fixed_frame_rate_flag = !!reader.next();
  }

  vui.nal_hrd_parameters_present_flag = !!reader.next();
  if (vui.nal_hrd_parameters_present_flag) {
    vui.nal_hrd_parameters = parseHrdParameters(reader);
  }

  vui.vcl_hrd_parameters_present_flag = !!reader.next();
  if (vui.vcl_hrd_parameters_present_flag) {
    vui.vcl_hrd_parameters = parseHrdParameters(reader);
  }

  if (vui.nal_hrd_parameters_present_flag || vui.vcl_hrd_parameters_present_flag) {
    vui.low_delay_hrd_flag = !!reader.next();
  }

  vui.pic_struct_present_flag = !!reader.next();

  vui.bitstream_restriction_flag = !!reader.next();
  if (vui.bitstream_restriction_flag) {
    vui.motion_vectors_over_pic_boundaries_flag = !!reader.next();
    vui.max_bytes_per_pic_denom = reader.decodeExponentialGolombNumber();
    vui.max_bits_per_mb_denom = reader.decodeExponentialGolombNumber();
    vui.log2_max_mv_length_horizontal = reader.decodeExponentialGolombNumber();
    vui.log2_max_mv_length_vertical = reader.decodeExponentialGolombNumber();
    vui.max_num_reorder_frames = reader.decodeExponentialGolombNumber();
    vui.max_dec_frame_buffering = reader.decodeExponentialGolombNumber();
  }

  return vui;
}

/**
 * Resolve pixel sample aspect ratio (SAR) from VUI parameters per H.264 Table E-1.
 */
export function getVuiSampleAspectRatio(vui: VuiParameters): { width: number; height: number } | undefined {
  if (!vui.aspect_ratio_info_present_flag || vui.aspect_ratio_idc === undefined) {
    return undefined;
  }
  if (vui.aspect_ratio_idc === EXTENDED_SAR) {
    if (vui.sar_width && vui.sar_height && vui.sar_width > 0 && vui.sar_height > 0) {
      return { width: vui.sar_width, height: vui.sar_height };
    }
    return undefined;
  }
  const entry = SAR_TABLE[vui.aspect_ratio_idc];
  if (entry && entry[0] > 0 && entry[1] > 0) {
    return { width: entry[0], height: entry[1] };
  }
  return undefined;
}

/**
 * Compute nominal frame rate (`time_scale / (2 * num_units_in_tick)`) from VUI timing info.
 */
export function getVuiFrameRate(vui: VuiParameters): number | undefined {
  if (!vui.timing_info_present_flag || !vui.num_units_in_tick || !vui.time_scale) {
    return undefined;
  }
  if (vui.num_units_in_tick <= 0 || vui.time_scale <= 0) {
    return undefined;
  }
  return vui.time_scale / (2 * vui.num_units_in_tick);
}

/**
 * Extract colorimetry metadata from VUI video signal type fields.
 */
export function getVuiColorimetry(vui: VuiParameters): VuiColorimetry | undefined {
  if (!vui.video_signal_type_present_flag || vui.video_format === undefined || vui.video_full_range_flag === undefined) {
    return undefined;
  }
  const result: VuiColorimetry = {
    videoFormat: vui.video_format,
    fullRange: vui.video_full_range_flag,
  };
  if (vui.colour_description_present_flag) {
    result.colourPrimaries = vui.colour_primaries;
    result.transferCharacteristics = vui.transfer_characteristics;
    result.matrixCoefficients = vui.matrix_coefficients;
  }
  return result;
}

// 7.3.2.1.1 Sequence parameter set data syntax
export function parse_sequence_parameter_set(buffer: ArrayBuffer | Uint8Array, _codec: string): ScrcpyHeader {
  for (const nalu of iterateNalu(new Uint8Array(buffer))) {
    const reader = new BitReader(nalu);
    if (reader.next() !== 0) {
      throw new Error('Invalid data');
    }

    const nal_ref_idc = reader.read(2);
    const nal_unit_type = reader.read(5);

    if (nal_unit_type !== 7) {
      continue;
    }

    if (nal_ref_idc === 0) {
      throw new Error('Invalid data');
    }

    const profile_idc = reader.read(8);
    const constraint_set = reader.read(8);

    const constraint_set_reader = new BitReader(new Uint8Array([constraint_set]));
    const constraint_set0_flag = !!constraint_set_reader.next();
    const constraint_set1_flag = !!constraint_set_reader.next();
    const constraint_set2_flag = !!constraint_set_reader.next();
    const constraint_set3_flag = !!constraint_set_reader.next();
    const constraint_set4_flag = !!constraint_set_reader.next();
    const constraint_set5_flag = !!constraint_set_reader.next();

    // reserved_zero_2bits
    if (constraint_set_reader.read(2) !== 0) {
      throw new Error('Invalid data');
    }

    const level_idc = reader.read(8);
    const seq_parameter_set_id = reader.decodeExponentialGolombNumber();

    if (profile_idc === 100 || profile_idc === 110 ||
      profile_idc === 122 || profile_idc === 244 || profile_idc === 44 ||
      profile_idc === 83 || profile_idc === 86 || profile_idc === 118 ||
      profile_idc === 128 || profile_idc === 138 || profile_idc === 139 ||
      profile_idc === 134) {
      const chroma_format_idc = reader.decodeExponentialGolombNumber();
      if (chroma_format_idc === 3) {
        // separate_colour_plane_flag
        reader.next();
      }

      // bit_depth_luma_minus8
      reader.decodeExponentialGolombNumber();
      // bit_depth_chroma_minus8
      reader.decodeExponentialGolombNumber();

      // qpprime_y_zero_transform_bypass_flag
      reader.next();

      const seq_scaling_matrix_present_flag = !!reader.next();
      if (seq_scaling_matrix_present_flag) {
        const seq_scaling_list_present_flag: boolean[] = [];
        for (let i = 0; i < ((chroma_format_idc !== 3) ? 8 : 12); i++) {
          seq_scaling_list_present_flag[i] = !!reader.next();
          if (seq_scaling_list_present_flag[i]) {
            if (i < 6) {
              skipScalingList(reader, 16);
            } else {
              skipScalingList(reader, 64);
            }
          }
        }
      }
    }

    // log2_max_frame_num_minus4
    reader.decodeExponentialGolombNumber();
    const pic_order_cnt_type = reader.decodeExponentialGolombNumber();
    if (pic_order_cnt_type === 0) {
      // log2_max_pic_order_cnt_lsb_minus4
      reader.decodeExponentialGolombNumber();
    } else if (pic_order_cnt_type === 1) {
      // delta_pic_order_always_zero_flag
      reader.next();
      // offset_for_non_ref_pic
      reader.decodeExponentialGolombNumber();
      // offset_for_top_to_bottom_field
      reader.decodeExponentialGolombNumber();
      const num_ref_frames_in_pic_order_cnt_cycle = reader.decodeExponentialGolombNumber();
      const offset_for_ref_frame: number[] = [];
      for (let i = 0; i < num_ref_frames_in_pic_order_cnt_cycle; i++) {
        offset_for_ref_frame[i] = reader.decodeExponentialGolombNumber();
      }
    }

    // max_num_ref_frames
    reader.decodeExponentialGolombNumber();
    // gaps_in_frame_num_value_allowed_flag
    reader.next();
    const pic_width_in_mbs_minus1 = reader.decodeExponentialGolombNumber();
    const pic_height_in_map_units_minus1 = reader.decodeExponentialGolombNumber();

    const frame_mbs_only_flag = reader.next();
    if (!frame_mbs_only_flag) {
      // mb_adaptive_frame_field_flag
      reader.next();
    }

    // direct_8x8_inference_flag
    reader.next();

    const frame_cropping_flag = !!reader.next();
    let frame_crop_left_offset: number;
    let frame_crop_right_offset: number;
    let frame_crop_top_offset: number;
    let frame_crop_bottom_offset: number;
    if (frame_cropping_flag) {
      frame_crop_left_offset = reader.decodeExponentialGolombNumber();
      frame_crop_right_offset = reader.decodeExponentialGolombNumber();
      frame_crop_top_offset = reader.decodeExponentialGolombNumber();
      frame_crop_bottom_offset = reader.decodeExponentialGolombNumber();
    } else {
      frame_crop_left_offset = 0;
      frame_crop_right_offset = 0;
      frame_crop_top_offset = 0;
      frame_crop_bottom_offset = 0;
    }

    const vui_parameters_present_flag = !!reader.next();
    let vui_parameters: VuiParameters | undefined;
    if (vui_parameters_present_flag) {
      vui_parameters = parseVuiParameters(reader);
    }

    return {
      profile_idc,
      constraint_set,
      constraint_set0_flag,
      constraint_set1_flag,
      constraint_set2_flag,
      constraint_set3_flag,
      constraint_set4_flag,
      constraint_set5_flag,
      level_idc,
      seq_parameter_set_id,
      pic_width_in_mbs_minus1,
      pic_height_in_map_units_minus1,
      frame_mbs_only_flag,
      frame_cropping_flag,
      frame_crop_left_offset,
      frame_crop_right_offset,
      frame_crop_top_offset,
      frame_crop_bottom_offset,
      vui_parameters_present_flag,
      vui_parameters,
    };
  }

  throw new Error('Invalid data');
}
