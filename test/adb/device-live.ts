import { expect } from 'chai';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import prebuilds from '@u4/minicap-prebuilt';
import { createClient, Utils } from '../../src/index.js';
import type DeviceClient from '../../src/adb/DeviceClient.js';
import type Scrcpy from '../../src/adb/thirdparty/scrcpy/Scrcpy.js';

const SCRCPY_VERSION = '3.3.1';
const REMOTE_JAR = `/data/local/tmp/scrcpy-server-v${SCRCPY_VERSION}.jar`;

async function withScrcpy(device: DeviceClient, action: (scrcpy: Scrcpy) => Promise<void>): Promise<void> {
  const localJar = prebuilds.getScrcpyJar(SCRCPY_VERSION);
  const localSize = (await fs.stat(localJar)).size;
  let existing;
  try {
    existing = await device.stat(REMOTE_JAR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing && existing.size !== localSize) {
    throw new Error(`[${device.serial}] ${REMOTE_JAR} already exists with a different size; refusing to overwrite it`);
  }
  const scrcpy = device.scrcpy({
    version: SCRCPY_VERSION, jarPath: localJar, autoDownload: false,
    noAudio: true, control: true, stayAwake: false, clipboardAutosync: false,
    maxSize: 600, maxFps: 15, bitrate: 2_000_000, tunnelDelay: 5000,
  });
  try {
    await action(scrcpy);
  } finally {
    scrcpy.stop();
    if (!existing) await device.execOut(['rm', '-f', REMOTE_JAR]);
  }
  expect(scrcpy.isRunning()).to.equal(false);
}

describe('[device] live Android integration', function () {
  this.timeout(30000);
  let devices: DeviceClient[];

  before(async () => {
    const client = createClient({ backend: 'native' });
    devices = (await client.listDevices()).filter(device => device.type === 'device').map(device => device.getClient());
    expect(devices.length, 'Connect at least one authorized Android device').to.be.greaterThan(0);
  });

  it('reads device properties and executes a shell command', async () => {
    for (const device of devices) {
      const properties = await device.getProperties();
      expect(properties['ro.build.version.sdk'], `[${device.serial}] Android SDK`).to.match(/^\d+$/);
      expect(properties['ro.product.model'], `[${device.serial}] model`).to.be.a('string').and.not.empty;
      expect((await device.execOut('echo adbkit-live-test', 'utf8')).trim()).to.equal('adbkit-live-test');
    }
  });

  it('captures a PNG screenshot', async () => {
    for (const device of devices) {
      const image = await Utils.readAll(await device.screencap());
      expect(image.subarray(0, 8), `[${device.serial}] PNG signature`).to.deep.equal(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(image.length).to.be.greaterThan(100);
    }
  });

  it('creates, lists and removes a TCP forward', async () => {
    for (const device of devices) {
      const remote = `localabstract:adbkit-test-${randomUUID()}`;
      let port: number | undefined;
      try {
        port = await device.tryForwardTCP(remote);
        expect((await device.listForwards()).some(forward => forward.local === `tcp:${port}` && forward.remote === remote)).to.equal(true);
        await device.removeForward(`tcp:${port}`);
        port = undefined;
        expect((await device.listForwards()).some(forward => forward.remote === remote)).to.equal(false);
      } finally {
        if (port !== undefined) await device.removeForward(`tcp:${port}`);
      }
    }
  });

  it('starts scrcpy, receives video metadata and a frame, then stops', async function () {
    this.timeout(60000);
    for (const device of devices) {
      await withScrcpy(device, async scrcpy => {
        const frames: Uint8Array[] = [];
        const errors: string[] = [];
        scrcpy.on('frame', frame => frames.push(frame.data));
        scrcpy.on('error', error => errors.push(error.message));
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await scrcpy.start();
          await Promise.race([
            scrcpy.firstFrame,
            scrcpy.onTermination.then(message => { throw new Error(`scrcpy stopped before a frame: ${message}`); }),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for scrcpy frame: ${errors.join('; ')}`)), 15000); }),
          ]);
          const [name, codec, width, height] = await Promise.all([scrcpy.name, scrcpy.codec, scrcpy.width, scrcpy.height]);
          expect(name, `[${device.serial}] device name`).to.be.a('string').and.not.empty;
          expect(codec.toLowerCase()).to.include('264');
          expect(width).to.be.greaterThan(0);
          expect(height).to.be.greaterThan(0);
          expect(frames.some(frame => frame.length > 0), `[${device.serial}] frame payload`).to.equal(true);
          expect(scrcpy.isRunning()).to.equal(true);
        } finally {
          if (timer) clearTimeout(timer);
        }
      });
    }
  });

  it('records a scrcpy H.264 frame to a local file', async function () {
    this.timeout(60000);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'adbkit-scrcpy-device-'));
    try {
      for (const device of devices) {
        await withScrcpy(device, async scrcpy => {
          const output = path.join(directory, `${randomUUID()}.h264`);
          scrcpy.on('error', () => {});
          const recording = await scrcpy.recordToFile(output, { durationMs: 8000, maxFrames: 1, remuxMp4: false });
          const video = await fs.readFile(output);
          expect(recording.frames, `[${device.serial}] recorded frames`).to.be.greaterThan(0);
          expect(recording.bytes).to.equal(video.length);
          expect(recording.width).to.be.greaterThan(0);
          expect(recording.height).to.be.greaterThan(0);
          expect(recording.codec.toLowerCase()).to.include('264');
          expect(video.subarray(0, 4)).to.deep.equal(Buffer.from([0, 0, 0, 1]));
        });
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
