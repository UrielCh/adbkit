import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import PromiseDuplex from 'promise-duplex';
import Scrcpy from '../../../src/adb/thirdparty/scrcpy/Scrcpy.js';
import { parseScrcpyVersion, getDefaultScrcpyJarPath, downloadScrcpyServer } from '../../../src/adb/thirdparty/scrcpy/ScrcpyDownload.js';
import { CaptureOrientationMap, OrientationMap } from '../../../src/adb/thirdparty/scrcpy/ScrcpyConst.js';

describe('Scrcpy 3.0 Support & Backwards Compatibility', () => {
  const dummyClient: any = {
    serial: 'dummy-serial',
    openLocal2: async () => {},
    shell: async () => {},
    push: async () => {},
    stat: async () => null,
  };

  describe('parseScrcpyVersion', () => {
    it('should parse simple version string', () => {
      expect(parseScrcpyVersion('4.0')).to.deep.equal({ version: '4.0' });
      expect(parseScrcpyVersion('v4.0')).to.deep.equal({ version: '4.0' });
      expect(parseScrcpyVersion('3.3.4')).to.deep.equal({ version: '3.3.4' });
      expect(parseScrcpyVersion('v3.3.4')).to.deep.equal({ version: '3.3.4' });
      expect(parseScrcpyVersion('3.3.1')).to.deep.equal({ version: '3.3.1' });
      expect(parseScrcpyVersion('v3.3.1')).to.deep.equal({ version: '3.3.1' });
      expect(parseScrcpyVersion('3.3')).to.deep.equal({ version: '3.3' });
      expect(parseScrcpyVersion('v3.3')).to.deep.equal({ version: '3.3' });
      expect(parseScrcpyVersion('3.2')).to.deep.equal({ version: '3.2' });
      expect(parseScrcpyVersion('v3.2')).to.deep.equal({ version: '3.2' });
      expect(parseScrcpyVersion('3.1')).to.deep.equal({ version: '3.1' });
      expect(parseScrcpyVersion('v3.1')).to.deep.equal({ version: '3.1' });
      expect(parseScrcpyVersion('3.0')).to.deep.equal({ version: '3.0' });
      expect(parseScrcpyVersion('v3.0')).to.deep.equal({ version: '3.0' });
      expect(parseScrcpyVersion('2.7')).to.deep.equal({ version: '2.7' });
    });

    it('should parse GitHub release tag URL', () => {
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/v4.0')).to.deep.equal({
        version: '4.0',
      });
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/v3.3.4')).to.deep.equal({
        version: '3.3.4',
      });
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/v3.3.1')).to.deep.equal({
        version: '3.3.1',
      });
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/v3.3')).to.deep.equal({
        version: '3.3',
      });
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/v3.2')).to.deep.equal({
        version: '3.2',
      });
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/v3.1')).to.deep.equal({
        version: '3.1',
      });
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/v3.0')).to.deep.equal({
        version: '3.0',
      });
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/3.0')).to.deep.equal({
        version: '3.0',
      });
    });

    it('should parse GitHub release download URL', () => {
      const url = 'https://github.com/Genymobile/scrcpy/releases/download/v3.0/scrcpy-server-v3.0';
      expect(parseScrcpyVersion(url)).to.deep.equal({
        version: '3.0',
        customUrl: url,
      });
    });

    it('should resolve default jar path', () => {
      const p = getDefaultScrcpyJarPath('3.0');
      expect(p).to.be.a('string');
      expect(p).to.include('scrcpy-server-v3.0.jar');
    });

    it('should download scrcpy-server v4.0 binary from release URL', async function () {
      this.timeout(20000);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-test-40-'));
      try {
        const downloadedFile = await downloadScrcpyServer('https://github.com/Genymobile/scrcpy/releases/tag/v4.0', {
          destDir: tmpDir,
          force: true,
        });

        expect(fs.existsSync(downloadedFile)).to.be.true;
        const stat = fs.statSync(downloadedFile);
        expect(stat.size).to.be.greaterThan(50000);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should download scrcpy-server v3.3.4 binary from release URL', async function () {
      this.timeout(20000);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-test-334-'));
      try {
        const downloadedFile = await downloadScrcpyServer('https://github.com/Genymobile/scrcpy/releases/tag/v3.3.4', {
          destDir: tmpDir,
          force: true,
        });

        expect(fs.existsSync(downloadedFile)).to.be.true;
        const stat = fs.statSync(downloadedFile);
        expect(stat.size).to.be.greaterThan(50000);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should download scrcpy-server v3.3 binary from release URL', async function () {
      this.timeout(20000);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-test-33-'));
      try {
        const downloadedFile = await downloadScrcpyServer('https://github.com/Genymobile/scrcpy/releases/tag/v3.3', {
          destDir: tmpDir,
          force: true,
        });

        expect(fs.existsSync(downloadedFile)).to.be.true;
        const stat = fs.statSync(downloadedFile);
        expect(stat.size).to.be.greaterThan(50000);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should download scrcpy-server v3.2 binary from release URL', async function () {
      this.timeout(20000);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-test-32-'));
      try {
        const downloadedFile = await downloadScrcpyServer('https://github.com/Genymobile/scrcpy/releases/tag/v3.2', {
          destDir: tmpDir,
          force: true,
        });

        expect(fs.existsSync(downloadedFile)).to.be.true;
        const stat = fs.statSync(downloadedFile);
        expect(stat.size).to.be.greaterThan(50000);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should download scrcpy-server v3.1 binary from release URL', async function () {
      this.timeout(20000);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-test-31-'));
      try {
        const downloadedFile = await downloadScrcpyServer('https://github.com/Genymobile/scrcpy/releases/tag/v3.1', {
          destDir: tmpDir,
          force: true,
        });

        expect(fs.existsSync(downloadedFile)).to.be.true;
        const stat = fs.statSync(downloadedFile);
        expect(stat.size).to.be.greaterThan(50000);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should download scrcpy-server v3.0 binary from release URL', async function () {
      this.timeout(20000);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-test-'));
      try {
        const downloadedFile = await downloadScrcpyServer('https://github.com/Genymobile/scrcpy/releases/tag/v3.0', {
          destDir: tmpDir,
          force: true,
        });

        expect(fs.existsSync(downloadedFile)).to.be.true;
        const stat = fs.statSync(downloadedFile);
        expect(stat.size).to.be.greaterThan(50000);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('Scrcpy startup command generation', () => {
    it('should generate v3.0 startup line by default', () => {
      const scrcpy = new Scrcpy(dummyClient);
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v3.0.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 3.0');
      expect(line).to.include('video_source=display');
      expect(line).to.include('scid=');
      // In scrcpy 3.0, lock_video_orientation is removed
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should generate v4.0 startup line with flexDisplay, keepActive, minSizeAlignment', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '4.0',
        newDisplay: '1024x768/160',
        flexDisplay: true,
        keepActive: true,
        minSizeAlignment: 8,
        cameraZoom: 1.5,
        cameraTorch: true,
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v4.0.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 4.0');
      expect(line).to.include('new_display=1024x768/160');
      expect(line).to.include('flex_display=true');
      expect(line).to.include('keep_active=true');
      expect(line).to.include('min_size_alignment=8');
      expect(line).to.include('camera_zoom=1.5');
      expect(line).to.include('camera_torch=true');
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should generate v3.3.4 startup line with displayImePolicy and vdDestroyContent', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '3.3.4',
        newDisplay: '1920x1080',
        displayImePolicy: 'local',
        vdDestroyContent: false,
        noAudio: false,
        audioSource: 'playback',
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v3.3.4.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 3.3.4');
      expect(line).to.include('new_display=1920x1080');
      expect(line).to.include('display_ime_policy=local');
      expect(line).to.include('vd_destroy_content=false');
      expect(line).to.include('audio_source=playback');
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should generate v3.3 startup line with displayImePolicy and vdDestroyContent', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '3.3',
        newDisplay: '1920x1080',
        displayImePolicy: 'local',
        vdDestroyContent: false,
        noAudio: false,
        audioSource: 'playback',
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v3.3.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 3.3');
      expect(line).to.include('new_display=1920x1080');
      expect(line).to.include('display_ime_policy=local');
      expect(line).to.include('vd_destroy_content=false');
      expect(line).to.include('audio_source=playback');
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should generate v3.2 startup line with displayImePolicy and audioSource', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '3.2',
        newDisplay: '1920x1080',
        displayImePolicy: 'hide',
        noAudio: false,
        audioSource: 'mic',
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v3.2.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 3.2');
      expect(line).to.include('new_display=1920x1080');
      expect(line).to.include('display_ime_policy=hide');
      expect(line).to.include('audio_source=mic');
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should generate v3.1 startup line with vdDestroyContent', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '3.1',
        newDisplay: '1920x1080',
        vdDestroyContent: false,
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v3.1.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 3.1');
      expect(line).to.include('new_display=1920x1080');
      expect(line).to.include('vd_destroy_content=false');
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should handle captureOrientation and angle in v3.0', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '3.0',
        captureOrientation: CaptureOrientationMap.LOCKED_90,
        angle: 45,
        newDisplay: '1920x1080',
        vdSystemDecorations: false,
        screenOffTimeout: 120,
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v3.0.jar');

      expect(line).to.include('capture_orientation=@90');
      expect(line).to.include('angle=45');
      expect(line).to.include('new_display=1920x1080');
      expect(line).to.include('vd_system_decorations=false');
      expect(line).to.include('screen_off_timeout=120');
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should convert lockedVideoOrientation to capture_orientation in v3.0 when captureOrientation is not set', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '3.0',
        lockedVideoOrientation: OrientationMap.LOCK_SCREEN_ORIENTATION_1,
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v3.0.jar');

      expect(line).to.include('capture_orientation=@90');
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should preserve v2.7 options (backwards compatibility)', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '2.7',
        lockedVideoOrientation: OrientationMap.LOCK_SCREEN_ORIENTATION_0,
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v2.7.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 2.7');
      expect(line).to.include('scid=');
      expect(line).to.include('lock_video_orientation=0');
      expect(line).to.not.include('capture_orientation');
    });

    it('should preserve v2.2 prefix requirement (v2.2)', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '2.2',
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v2.2.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server v2.2');
    });

    it('should preserve v1.x positional arguments (backwards compatibility)', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '1.24',
        maxSize: 800,
        bitrate: 4000000,
        maxFps: 30,
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v1.24.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 1.24 info 800 4000000 30');
      expect(line).to.not.include('scid=');
      expect(line).to.not.include('video_bit_rate=');
    });
  });

  describe('Scrcpy v4.0 control messages', () => {
    let writtenChunks: Buffer[] = [];
    const mockControlSocket: any = {
      write: async (buf: Buffer) => {
        writtenChunks.push(buf);
      },
    };

    beforeEach(() => {
      writtenChunks = [];
    });

    it('should send TYPE_CAMERA_SET_TORCH control message', async () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '4.0' });
      (scrcpy as any).controlSocket = mockControlSocket;

      await scrcpy.setCameraTorch(true);
      expect(writtenChunks).to.have.lengthOf(1);
      expect(writtenChunks[0]).to.deep.equal(Buffer.from([18, 1]));

      await scrcpy.setCameraTorch(false);
      expect(writtenChunks).to.have.lengthOf(2);
      expect(writtenChunks[1]).to.deep.equal(Buffer.from([18, 0]));
    });

    it('should send TYPE_CAMERA_ZOOM_IN control message', async () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '4.0' });
      (scrcpy as any).controlSocket = mockControlSocket;

      await scrcpy.cameraZoomIn();
      expect(writtenChunks).to.have.lengthOf(1);
      expect(writtenChunks[0]).to.deep.equal(Buffer.from([19]));
    });

    it('should send TYPE_CAMERA_ZOOM_OUT control message', async () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '4.0' });
      (scrcpy as any).controlSocket = mockControlSocket;

      await scrcpy.cameraZoomOut();
      expect(writtenChunks).to.have.lengthOf(1);
      expect(writtenChunks[0]).to.deep.equal(Buffer.from([20]));
    });

    it('should send TYPE_RESIZE_DISPLAY control message', async () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '4.0' });
      (scrcpy as any).controlSocket = mockControlSocket;

      await scrcpy.resizeDisplay(1920, 1080);
      expect(writtenChunks).to.have.lengthOf(1);
      const expected = Buffer.alloc(5);
      expected.writeUInt8(21, 0);
      expected.writeUInt16BE(1920, 1);
      expected.writeUInt16BE(1080, 3);
      expect(writtenChunks[0]).to.deep.equal(expected);
    });
  });

  describe('Scrcpy video stream header & session metadata', () => {
    it('should correctly parse scrcpy 4.0 stream headers without width taking 2147483648', async () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '4.0' });
      const mockStream = new PassThrough();
      const mockPromiseDuplex = new PromiseDuplex(mockStream);
      (scrcpy as any).videoSocket = mockPromiseDuplex;

      // Start stream in background
      const streamPromise = (scrcpy as any).startStreamWithMeta();

      // 1. Device name (64 bytes)
      const nameBuf = Buffer.alloc(64);
      nameBuf.write('TestDevice', 'utf8');
      mockStream.write(nameBuf);

      // 2. Codec ID (4 bytes) - H264 is 0x68323634
      const codecBuf = Buffer.alloc(4);
      codecBuf.writeUInt32BE(0x68323634, 0);
      mockStream.write(codecBuf);

      // 3. Initial Session Meta (12 bytes)
      // flags has MSB set (bit 31 = 1) -> 0x80000000 = 2147483648
      // width = 1080, height = 2400
      const sessionBuf = Buffer.alloc(12);
      sessionBuf.writeUInt32BE(0x80000000, 0); // PACKET_FLAG_SESSION
      sessionBuf.writeUInt32BE(1080, 4);
      sessionBuf.writeUInt32BE(2400, 8);
      mockStream.write(sessionBuf);

      // Verify that scrcpy.width and scrcpy.height resolve to real dimensions, not 2147483648
      const width = await scrcpy.width;
      const height = await scrcpy.height;
      const codec = await scrcpy.codec;
      const name = await scrcpy.name;

      expect(name).to.equal('TestDevice');
      expect(codec).to.equal('H264');
      expect(width).to.equal(1080);
      expect(width).to.not.equal(2147483648);
      expect(height).to.equal(2400);

      // Close stream
      mockStream.end();
      await streamPromise;
    });

    it('should correctly parse scrcpy 3.x stream headers (backwards compatibility)', async () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '3.0' });
      const mockStream = new PassThrough();
      const mockPromiseDuplex = new PromiseDuplex(mockStream);
      (scrcpy as any).videoSocket = mockPromiseDuplex;

      // Start stream in background
      const streamPromise = (scrcpy as any).startStreamWithMeta();

      // 1. Device name (64 bytes)
      const nameBuf = Buffer.alloc(64);
      nameBuf.write('TestDeviceV3', 'utf8');
      mockStream.write(nameBuf);

      // 2. Codec Header in v3.x (12 bytes: codecId, width, height)
      const codecHeaderBuf = Buffer.alloc(12);
      codecHeaderBuf.writeUInt32BE(0x68323634, 0); // H264
      codecHeaderBuf.writeUInt32BE(1080, 4);
      codecHeaderBuf.writeUInt32BE(1920, 8);
      mockStream.write(codecHeaderBuf);

      const width = await scrcpy.width;
      const height = await scrcpy.height;
      const codec = await scrcpy.codec;
      const name = await scrcpy.name;

      expect(name).to.equal('TestDeviceV3');
      expect(codec).to.equal('H264');
      expect(width).to.equal(1080);
      expect(height).to.equal(1920);

      mockStream.end();
      await streamPromise;
    });
  });
});
