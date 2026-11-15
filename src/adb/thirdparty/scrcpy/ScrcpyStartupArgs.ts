import { OrientationMap } from './ScrcpyConst.js';
import type { ScrcpyOptions } from './ScrcpyModels.js';

export interface ParsedScrcpyVersion {
  major: number;
  minor: number;
  patch: number;
  strVersion: string;
}

const ORIENTATION_TO_CAPTURE: ReadonlyMap<number, string> = new Map<number, string>([
  [OrientationMap.LOCK_VIDEO_ORIENTATION_INITIAL, '@'],
  [OrientationMap.LOCK_SCREEN_ORIENTATION_0, '@0'],
  [OrientationMap.LOCK_SCREEN_ORIENTATION_1, '@90'],
  [OrientationMap.LOCK_SCREEN_ORIENTATION_2, '@180'],
  [OrientationMap.LOCK_SCREEN_ORIENTATION_3, '@270'],
]);

/**
 * Parse a scrcpy server version string (e.g. `'v5.0.1'` or `'3'`) into numeric parts and a padded sortable string.
 */
export function parseScrcpyVersionParts(version: string): ParsedScrcpyVersion {
  const rawVersion = version.replace(/^v/i, '');
  const versionParts = rawVersion.split('.').map((part) => {
    const n = Number(part);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
  });
  const major = versionParts[0] ?? 0;
  const minor = versionParts[1] ?? 0;
  const patch = versionParts[2] ?? 0;
  const strVersion = `${major.toString().padStart(2, '0')}.${minor.toString().padStart(2, '0')}.${patch.toString().padStart(2, '0')}`;
  return { major, minor, patch, strVersion };
}

/**
 * POSIX shell-escape a single startup argument.
 */
export function shellEscapeArg(arg: string | number | boolean): string {
  const s = arg.toString();
  if (s.length === 0) {
    return "''";
  }
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(s)) {
    return s;
  }
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}

function pushV1Args(args: Array<string | number | boolean>, config: ScrcpyOptions): void {
  args.push(
    'info', // Log level: info, verbose...
    config.maxSize, // Max screen width (long side)
    config.bitrate, // Bitrate of video
    config.maxFps, // Max frame per second
    config.lockedVideoOrientation, // Lock screen orientation: LOCK_SCREEN_ORIENTATION
    config.tunnelForward, // Tunnel forward
    config.crop || '-', // Crop screen
    config.sendFrameMeta, // Send frame rate to client
    config.control, // Control enabled
    config.displayId, // Display id
    config.showTouches, // Show touches
    config.stayAwake, // Stay awake
    config.codecOptions || '-', // Codec (video encoding) options
    config.encoderName || '-', // Encoder name
    config.powerOffScreenOnClose, // Power off screen after server closed
  );
}

function pushV3PlusOrientationAndDisplayArgs(
  args: Array<string | number | boolean>,
  config: ScrcpyOptions,
  versionInfo: ParsedScrcpyVersion,
): void {
  const {
    captureOrientation,
    lockedVideoOrientation,
    angle,
    newDisplay,
    vdSystemDecorations,
    vdDestroyContent,
    displayImePolicy,
    screenOffTimeout,
    flexDisplay,
    keepActive,
    minSizeAlignment,
    cameraZoom,
    cameraTorch,
    ignoreVideoEncoderConstraints,
  } = config;

  // In scrcpy 3.0+, lock_video_orientation was replaced by capture_orientation and angle
  if (captureOrientation) {
    args.push(`capture_orientation=${captureOrientation}`);
  } else if (lockedVideoOrientation !== OrientationMap.LOCK_VIDEO_ORIENTATION_UNLOCKED) {
    const mapped = ORIENTATION_TO_CAPTURE.get(lockedVideoOrientation);
    if (mapped) {
      args.push(`capture_orientation=${mapped}`);
    }
  }

  if (angle !== undefined) {
    args.push(`angle=${angle}`);
  }
  if (newDisplay) {
    args.push(`new_display=${newDisplay}`);
  }
  if (vdSystemDecorations !== undefined) {
    args.push(`vd_system_decorations=${vdSystemDecorations}`);
  }
  if (versionInfo.strVersion >= '03.01.00' && vdDestroyContent !== undefined) {
    args.push(`vd_destroy_content=${vdDestroyContent}`);
  }
  if (versionInfo.strVersion >= '03.02.00' && displayImePolicy) {
    args.push(`display_ime_policy=${displayImePolicy}`);
  }
  if (screenOffTimeout !== undefined) {
    args.push(`screen_off_timeout=${screenOffTimeout}`);
  }
  if (versionInfo.major >= 4) {
    if (flexDisplay !== undefined) {
      args.push(`flex_display=${flexDisplay}`);
    }
    if (keepActive !== undefined) {
      args.push(`keep_active=${keepActive}`);
    }
    if (minSizeAlignment !== undefined) {
      args.push(`min_size_alignment=${minSizeAlignment}`);
    }
    if (cameraZoom !== undefined) {
      args.push(`camera_zoom=${cameraZoom}`);
    }
    if (cameraTorch !== undefined) {
      args.push(`camera_torch=${cameraTorch}`);
    }
    if (versionInfo.strVersion >= '04.01.00' && ignoreVideoEncoderConstraints !== undefined) {
      args.push(`ignore_video_encoder_constraints=${ignoreVideoEncoderConstraints}`);
    }
  }
}

function pushV2PlusArgs(
  args: Array<string | number | boolean>,
  config: ScrcpyOptions,
  versionInfo: ParsedScrcpyVersion,
): void {
  const {
    maxSize,
    bitrate,
    maxFps,
    lockedVideoOrientation,
    tunnelForward,
    crop,
    sendFrameMeta,
    control,
    displayId,
    showTouches,
    stayAwake,
    codecOptions,
    encoderName,
    powerOffScreenOnClose,
    clipboardAutosync,
    audioSource,
    videoCodec,
    downsizeOnError,
    sendDeviceMeta,
    sendDummyByte,
    rawVideoStream,
    cleanup,
  } = config;

  args.push(`scid=${config.scid}`);
  if (config.noAudio) {
    args.push('audio=false');
  } else if (audioSource) {
    args.push(`audio_source=${audioSource}`);
  }

  if (versionInfo.strVersion >= '02.04.00') {
    args.push('video_source=display');
  }
  if (videoCodec) {
    args.push(`video_codec=${videoCodec}`);
  }

  args.push(
    'log_level=info',
    `max_size=${maxSize}`,
    'clipboard_autosync=false', // cause crash on some newer phone and we do not use that feature.
    `video_bit_rate=${bitrate}`,
    `max_fps=${maxFps}`,
  );

  if (versionInfo.major >= 3) {
    pushV3PlusOrientationAndDisplayArgs(args, config, versionInfo);
  } else {
    args.push(`lock_video_orientation=${lockedVideoOrientation}`);
  }

  args.push(`tunnel_forward=${tunnelForward}`);
  if (crop && crop !== '-') {
    args.push(`crop=${crop}`);
  }
  args.push(
    `send_frame_meta=${sendFrameMeta}`,
    `control=${control}`,
    `display_id=${displayId}`,
    `show_touches=${showTouches}`,
    `stay_awake=${stayAwake}`,
  );
  if (codecOptions && codecOptions !== '-') {
    args.push(`video_codec_options=${codecOptions}`);
  }
  if (encoderName && encoderName !== '-') {
    args.push(`video_encoder=${encoderName}`);
  }
  args.push(`power_off_on_close=${powerOffScreenOnClose}`);
  if (clipboardAutosync !== undefined) {
    args.push(`clipboard_autosync=${clipboardAutosync}`);
  }
  if (downsizeOnError !== undefined) {
    args.push(`downsize_on_error=${downsizeOnError}`);
  }
  if (sendDeviceMeta !== undefined) {
    args.push(`send_device_meta=${sendDeviceMeta}`);
  }
  if (sendDummyByte !== undefined) {
    args.push(`send_dummy_byte=${sendDummyByte}`);
  }
  if (rawVideoStream !== undefined) {
    args.push(`raw_video_stream=${rawVideoStream}`);
  }
  if (cleanup !== undefined) {
    args.push(`cleanup=${cleanup}`);
  }
}

/**
 * Build the escaped `CLASSPATH=... app_process / com.genymobile.scrcpy.Server ...` command line.
 */
export function buildScrcpyStartupLine(
  config: ScrcpyOptions,
  versionInfo: ParsedScrcpyVersion,
  jarDest = '/data/local/tmp/scrcpy-server.jar',
): string {
  const envAssignment = `CLASSPATH=${shellEscapeArg(jarDest)}`;
  const args: Array<string | number | boolean> = ['app_process', '/', 'com.genymobile.scrcpy.Server'];

  // V2.2 is the only version that expects a v prefix
  args.push(versionInfo.strVersion === '02.02.00' ? `v${config.version}` : config.version);

  if (versionInfo.major < 2) {
    pushV1Args(args, config);
  } else {
    pushV2PlusArgs(args, config, versionInfo);
  }

  return `${envAssignment} ${args.map(shellEscapeArg).join(' ')}`;
}
