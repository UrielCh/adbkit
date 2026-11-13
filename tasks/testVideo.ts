import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import pc from 'picocolors';

import adb, {
  DeviceClient,
  ScrcpyOptions,
  Utils,
} from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * =========================================================================================
 * SUMMARY OF AVAILABLE VIDEO ENCODINGS IN SCRCPY & ANDROID
 * =========================================================================================
 *
 * 1. CODECS OVERVIEW:
 * -------------------
 * - H.264 / AVC (`videoCodec: 'h264'`):
 *   - Usage & Strengths: Universal compatibility across virtually all Android devices,
 *     operating systems, web browsers, and media players.
 *   - Latency & Overhead: Extremely low latency and low CPU overhead due to widespread
 *     hardware encoder support on almost all mobile chipsets.
 *   - Best used for: Default screen recording, real-time streaming, and cross-platform playback.
 *
 * - H.265 / HEVC (`videoCodec: 'h265'`):
 *   - Usage & Strengths: High-Efficiency Video Coding provides ~40-50% bitrate reduction
 *     compared to H.264 at equivalent visual quality.
 *   - Best used for: High-resolution captures (1080p, 1440p, 4K), storage savings, or
 *     bandwidth-constrained transfers.
 *   - Note: Requires an H.265 hardware encoder on the device (present on most modern devices)
 *     and a player supporting HEVC/H.265 (e.g. VLC, mpv, or remuxed into MP4 with modern decoders).
 *
 * - AV1 (`videoCodec: 'av1'`):
 *   - Usage & Strengths: Next-generation, open, royalty-free video codec with superior compression.
 *   - Best used for: Advanced setups on Android 14+ devices supporting AV1 encoding.
 *
 * 2. ENCODER TYPES (Hardware vs Software):
 * -----------------------------------------
 * - Default / Hardware Encoder (`encoderName: undefined`):
 *   - Lets Android's MediaCodec framework select the platform's primary hardware encoder
 *     (e.g., Qualcomm OMX/C2, Samsung Exynos, MediaTek, Google Tensor).
 *   - Best used for: Production recordings, zero frame drops, minimal battery drain, and lowest latency.
 *
 * - Modern Software Codec2 Encoder (`c2.android.avc.encoder`):
 *   - Android's modern software implementation (introduced in Android 10 with the Codec2 framework).
 *   - Best used for: Android emulators, headless testing environments, devices where vendor
 *     hardware encoders produce corrupted frames or sizing restrictions, or cross-device reproducibility.
 *
 * - Legacy Google OpenMAX Software Encoder (`OMX.google.h264.encoder`):
 *   - The traditional AOSP software encoder based on libvpx/libavc.
 *   - Best used for: Older Android versions (pre-Android 10), compatibility fallbacks,
 *     or debugging encoder-specific issues.
 * =========================================================================================
 */

interface EncodingConfig {
  id: string;
  videoCodec?: 'h264' | 'h265' | 'av1' | string;
  encoderName?: string;
  fileExt: string;
  description: string;
}

const ENCODINGS: EncodingConfig[] = [
  {
    id: 'h264-default',
    videoCodec: 'h264',
    fileExt: 'h264',
    description: 'H.264 (default hardware encoder: maximum compatibility & lowest latency)',
  },
  {
    id: 'h265-hevc',
    videoCodec: 'h265',
    fileExt: 'h265',
    description: 'H.265 / HEVC (higher compression: ~40% smaller file size, ideal for high-res)',
  },
  {
    id: 'h264-sw-c2',
    videoCodec: 'h264',
    encoderName: 'c2.android.avc.encoder',
    fileExt: 'h264',
    description: 'H.264 (c2.android.avc.encoder: Android 10+ standard software fallback)',
  },
  {
    id: 'h264-sw-omx',
    videoCodec: 'h264',
    encoderName: 'OMX.google.h264.encoder',
    fileExt: 'h264',
    description: 'H.264 (OMX.google.h264.encoder: legacy AOSP software fallback)',
  },
];

/**
 * Format byte size into human readable string.
 */
function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  } else if (bytes > 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
  return bytes + ' B';
}

/**
 * Start the Clock application on the device.
 */
async function startClockApplication(deviceClient: DeviceClient): Promise<void> {
  console.log(pc.blue('-> Starting Clock application...'));

  // 1. Try standard Clock action: SHOW_ALARMS
  try {
    console.log('   Trying android.intent.action.SHOW_ALARMS...');
    await deviceClient.startActivity({
      action: 'android.intent.action.SHOW_ALARMS',
      wait: true,
    });
    console.log(pc.green('   Clock app started via SHOW_ALARMS intent.'));
    await Utils.delay(1500);
    return;
  } catch (err) {
    console.log(pc.yellow(`   SHOW_ALARMS failed: ${(err as Error).message}. Trying alternatives...`));
  }

  // 2. Try APP_CLOCK category
  try {
    console.log('   Trying category android.intent.category.APP_CLOCK...');
    await deviceClient.startActivity({
      action: 'android.intent.action.MAIN',
      category: 'android.intent.category.APP_CLOCK',
      wait: true,
    });
    console.log(pc.green('   Clock app started via APP_CLOCK category.'));
    await Utils.delay(1500);
    return;
  } catch (err) {
    console.log(pc.yellow(`   APP_CLOCK failed: ${(err as Error).message}. Trying package search...`));
  }

  // 3. Fallback: Search installed packages for clock
  const output = await deviceClient.execOut('pm list packages | grep -E "clock|deskclock"', 'utf8');
  const packages = output
    .split(/\r?\n/)
    .map((l) => l.replace(/^package:/, '').trim())
    .filter(Boolean);

  if (packages.length > 0) {
    const pkg = packages[0];
    console.log(`   Found clock package ${pc.cyan(pkg)}, launching...`);
    await deviceClient.execOut(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, 'utf8');
    console.log(pc.green(`   Clock app (${pkg}) launched via monkey.`));
    await Utils.delay(1500);
    return;
  }

  console.warn(pc.red('   Could not automatically find/launch clock application!'));
}

/**
 * Record screen to a video file using the specified encoding configuration.
 */
async function recordWithEncoding(
  deviceClient: DeviceClient,
  encoding: EncodingConfig,
  outputDir: string,
  durationSec = 4,
  scrcpyVersion: ScrcpyOptions['version'] = '3.0'
): Promise<string | null> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetMp4Path = path.join(outputDir, `record_${encoding.id}_${timestamp}.mp4`);

  console.log(pc.cyan(`\n=== Recording with [${encoding.id}] (${encoding.description}) ===`));
  console.log(`   Target MP4: ${pc.yellow(targetMp4Path)}`);
  console.log(`   Duration: ${durationSec}s`);

  const scrcpyOptions: Partial<ScrcpyOptions> = {
    version: scrcpyVersion,
    maxFps: 30,
    maxSize: 1080,
    stayAwake: true,
  };

  if (encoding.videoCodec) {
    scrcpyOptions.videoCodec = encoding.videoCodec;
  }
  if (encoding.encoderName) {
    scrcpyOptions.encoderName = encoding.encoderName;
  }

  try {
    const result = await deviceClient.recordScreen(targetMp4Path, scrcpyOptions, {
      durationMs: durationSec * 1000,
      remuxMp4: true,
      onProgress: (prog) => {
        if (prog.frames % 30 === 0) {
          process.stdout.write(
            `\r   Progress: ${prog.frames} frames (${prog.keyframes} keyframes, ${fmtSize(prog.bytes)})...`
          );
        }
      },
    });

    console.log(
      pc.green(
        `\n   Recording succeeded! ${result.frames} frames, ${fmtSize(result.bytes)} (${result.codec} ${result.width}x${result.height})`
      )
    );
    console.log(`   Output file: ${pc.bold(pc.green(result.filePath))}`);
    return result.filePath;
  } catch (err) {
    console.error(pc.red(`   Recording failed for ${encoding.id}: ${(err as Error).message}`));
    return null;
  }
}

async function main() {
  console.log(pc.bold(pc.cyan('=== Scrcpy Multi-Encoding Video Recording Test ===\n')));

  const adbClient = adb.createClient();
  const devices = await adbClient.listDevices();

  if (!devices.length) {
    console.error(pc.red('Error: Need at least one connected Android device.'));
    process.exit(1);
  }

  const device = devices[0];
  console.log(`Target device: ${pc.green(device.id)}`);
  const deviceClient = device.getClient();

  try {
    const encoders = await deviceClient.listVideoEncoders();
    if (encoders.length > 0) {
      console.log(`Detected device video encoders: ${encoders.map((e) => `${pc.yellow(e.name)} (${pc.cyan(e.codec)})`).join(', ')}`);
    }
  } catch {
    // ignore
  }

  // Create recordings output directory
  const outputDir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. Start the clock application
  await startClockApplication(deviceClient);

  // 2. Discover / Test multiple encodings
  const recordedFiles: string[] = [];

  for (const encoding of ENCODINGS) {
    try {
      const recorded = await recordWithEncoding(deviceClient, encoding, outputDir, 4);
      if (recorded) {
        recordedFiles.push(recorded);
      }
      // Small delay between encoding runs to allow sockets and server to release
      await Utils.delay(1000);
    } catch (e) {
      console.error(pc.red(`Error during encoding ${encoding.id}: ${(e as Error).message}`));
    }
  }

  console.log(pc.bold(pc.magenta('\n=== Summary of Recorded Video Files ===')));
  if (recordedFiles.length === 0) {
    console.log(pc.red('No video files recorded.'));
  } else {
    for (const f of recordedFiles) {
      const stat = fs.statSync(f);
      console.log(` - ${pc.green(f)} (${fmtSize(stat.size)})`);
    }
  }
  console.log(pc.bold(pc.cyan('\nDone!')));
}

main().catch((err) => {
  console.error(pc.red('Fatal error:'), err);
  process.exit(1);
});

