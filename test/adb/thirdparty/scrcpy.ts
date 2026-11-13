import { expect } from 'chai';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import PromiseDuplex from 'promise-duplex';
import sinon from 'sinon';
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
      expect(parseScrcpyVersion('5.0.1')).to.deep.equal({ version: '5.0.1' });
      expect(parseScrcpyVersion('v5.0.1')).to.deep.equal({ version: '5.0.1' });
      expect(parseScrcpyVersion('5.0')).to.deep.equal({ version: '5.0' });
      expect(parseScrcpyVersion('v5.0')).to.deep.equal({ version: '5.0' });
      expect(parseScrcpyVersion('4.1')).to.deep.equal({ version: '4.1' });
      expect(parseScrcpyVersion('v4.1')).to.deep.equal({ version: '4.1' });
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
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/v5.0.1')).to.deep.equal({
        version: '5.0.1',
      });
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/v5.0')).to.deep.equal({
        version: '5.0',
      });
      expect(parseScrcpyVersion('https://github.com/Genymobile/scrcpy/releases/tag/v4.1')).to.deep.equal({
        version: '4.1',
      });
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

    it('should fall back to XDG_CACHE_HOME when prebuilt dir is not writable and jar is missing', () => {
      const prevXdg = process.env.XDG_CACHE_HOME;
      const accessStub = sinon.stub(fs, 'accessSync').throws(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
      const existsStub = sinon.stub(fs, 'existsSync').returns(false);
      process.env.XDG_CACHE_HOME = '/tmp/custom-xdg-cache';
      try {
        const p = getDefaultScrcpyJarPath('99.9.9');
        expect(p).to.equal(path.join('/tmp/custom-xdg-cache', '@u4', 'adbkit', 'scrcpy', 'scrcpy-server-v99.9.9.jar'));
      } finally {
        accessStub.restore();
        existsStub.restore();
        if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME;
        else process.env.XDG_CACHE_HOME = prevXdg;
      }
    });

    it('should handle fileStream errors cleanly in downloadScrcpyServer without unhandled stream errors', async () => {
      const fetchStub = sinon.stub(globalThis, 'fetch').resolves(
        new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-length': '4' } })
      );
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-dl-err-'));
      const failingStream = new Writable({
        write(_chunk, _enc, cb) {
          cb(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }));
        },
      });
      const createWriteStreamStub = sinon.stub(fs, 'createWriteStream').returns(failingStream as any);
      try {
        let caught: Error | undefined;
        try {
          await downloadScrcpyServer('3.0', {
            destDir: tmpDir,
            force: true,
            url: 'https://example.com/scrcpy-server-v3.0',
          });
        } catch (err) {
          caught = err as Error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(caught!.message).to.include('ENOSPC');
      } finally {
        createWriteStreamStub.restore();
        fetchStub.restore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    const nt = process.env.RUN_NETWORK_TESTS ? it : xit;
    const scrcpyVersions = ['5.0.1', '5.0', '4.1', '4.0', '3.3.4', '3.3', '3.2', '3.1', '3.0'];

    for (const version of scrcpyVersions) {
      it(`should download scrcpy-server v${version} binary from release URL (mocked)`, async () => {
        const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04]);
        const fetchStub = sinon.stub(globalThis, 'fetch').resolves(
          new Response(payload, { status: 200, headers: { 'content-length': String(payload.byteLength) } })
        );
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `scrcpy-mock-${version}-`));
        try {
          const downloadedFile = await downloadScrcpyServer(`https://github.com/Genymobile/scrcpy/releases/tag/v${version}`, {
            destDir: tmpDir,
            force: true,
          });

          expect(fetchStub.calledOnce).to.be.true;
          expect(fetchStub.firstCall.args[0]).to.equal(
            `https://github.com/Genymobile/scrcpy/releases/download/v${version}/scrcpy-server-v${version}`
          );
          expect(downloadedFile).to.equal(path.join(tmpDir, `scrcpy-server-v${version}.jar`));
          expect(fs.existsSync(downloadedFile)).to.be.true;
          expect(fs.statSync(downloadedFile).size).to.equal(payload.byteLength);
        } finally {
          fetchStub.restore();
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      });

      nt(`should download scrcpy-server v${version} binary from live release URL`, async function (this: Mocha.Context) {
        this.timeout(20000);
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `scrcpy-test-${version}-`));
        try {
          const downloadedFile = await downloadScrcpyServer(`https://github.com/Genymobile/scrcpy/releases/tag/v${version}`, {
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
    }
  });

  describe('Scrcpy startup command generation', () => {
    it('should generate v5.0.1 startup line by default', () => {
      const scrcpy = new Scrcpy(dummyClient);
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v5.0.1.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 5.0.1');
      expect(line).to.include('video_source=display');
      expect(line).to.include('scid=');
      // In scrcpy 3.0+, lock_video_orientation is removed
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should generate v3.0 startup line when version is 3.0', () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '3.0' });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v3.0.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 3.0');
      expect(line).to.include('video_source=display');
      expect(line).to.include('scid=');
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should generate v5.0.1 startup line with flexDisplay, ignoreVideoEncoderConstraints, and videoCodec', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '5.0.1',
        newDisplay: '1024x768/160',
        videoCodec: 'h265',
        ignoreVideoEncoderConstraints: false,
        flexDisplay: true,
        keepActive: true,
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v5.0.1.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 5.0.1');
      expect(line).to.include('video_codec=h265');
      expect(line).to.include('ignore_video_encoder_constraints=false');
      expect(line).to.include('flex_display=true');
      expect(line).to.include('keep_active=true');
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should generate v5.0 startup line with flexDisplay, ignoreVideoEncoderConstraints, and videoCodec', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '5.0',
        newDisplay: '1024x768/160',
        videoCodec: 'h265',
        ignoreVideoEncoderConstraints: false,
        flexDisplay: true,
        keepActive: true,
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v5.0.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 5.0');
      expect(line).to.include('video_codec=h265');
      expect(line).to.include('ignore_video_encoder_constraints=false');
      expect(line).to.include('flex_display=true');
      expect(line).to.include('keep_active=true');
      expect(line).to.not.include('lock_video_orientation');
    });

    it('should generate v4.1 startup line with ignoreVideoEncoderConstraints and videoCodec', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '4.1',
        newDisplay: '1024x768/160',
        videoCodec: 'vp9',
        ignoreVideoEncoderConstraints: true,
        flexDisplay: true,
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy-server-v4.1.jar');

      expect(line).to.include('com.genymobile.scrcpy.Server 4.1');
      expect(line).to.include('video_codec=vp9');
      expect(line).to.include('ignore_video_encoder_constraints=true');
      expect(line).to.include('flex_display=true');
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

    it('should parse version string without dots cleanly without NaN', () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '3' });
      expect(scrcpy.major).to.equal(3);
      expect(scrcpy.minor).to.equal(0);
      expect(scrcpy.patch).to.equal(0);
      expect(scrcpy.strVersion).to.equal('03.00.00');
      const line = scrcpy.getStartupLine('/data/local/tmp/scrcpy.jar');
      expect(line).to.include('com.genymobile.scrcpy.Server 3');
      expect(line).to.include('scid=');
    });

    it('should shell-escape jarDest and unsafe config arguments', () => {
      const scrcpy = new Scrcpy(dummyClient, {
        version: '4.1',
        crop: '100:100:0:0;id',
        encoderName: "OMX.qcom 'test'",
        newDisplay: '1024x768 $(whoami)',
      });
      const line = scrcpy.getStartupLine('/data/local/tmp/my scrcpy.jar');

      expect(line).to.include("CLASSPATH='/data/local/tmp/my scrcpy.jar' ");
      expect(line).to.include("'crop=100:100:0:0;id'");
      expect(line).to.include("'video_encoder=OMX.qcom '\"'\"'test'\"'\"''");
      expect(line).to.include("'new_display=1024x768 $(whoami)'");
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

    it('should send TYPE_SCAN_FILE control message in v4.1', async () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '4.1' });
      (scrcpy as any).controlSocket = mockControlSocket;

      await scrcpy.scanFile('/sdcard/Download/test.jpg');
      expect(writtenChunks).to.have.lengthOf(1);
      const filePath = '/sdcard/Download/test.jpg';
      const expected = Buffer.alloc(1 + 4 + filePath.length);
      expected.writeUInt8(22, 0);
      expected.writeUInt32BE(filePath.length, 1);
      expected.write(filePath, 5, 'utf8');
      expect(writtenChunks[0]).to.deep.equal(expected);
    });

    it('should send TYPE_COLLAPSE_PANELS control message for collapsePanels and collapsePannels', async () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '4.1' });
      (scrcpy as any).controlSocket = mockControlSocket;

      await scrcpy.collapsePanels();
      await scrcpy.collapsePannels();
      expect(writtenChunks).to.have.lengthOf(2);
      expect(writtenChunks[0]).to.deep.equal(Buffer.from([7]));
      expect(writtenChunks[1]).to.deep.equal(Buffer.from([7]));
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

    it('should identify VP8 and VP9 codecs in v4.1', async () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '4.1' });
      const mockStream = new PassThrough();
      const mockPromiseDuplex = new PromiseDuplex(mockStream);
      (scrcpy as any).videoSocket = mockPromiseDuplex;

      const streamPromise = (scrcpy as any).startStreamWithMeta();

      const nameBuf = Buffer.alloc(64);
      nameBuf.write('VP9Device', 'utf8');
      mockStream.write(nameBuf);

      // VP9 codec ID: 0x00767039
      const codecBuf = Buffer.alloc(4);
      codecBuf.writeUInt32BE(0x00767039, 0);
      mockStream.write(codecBuf);

      const sessionBuf = Buffer.alloc(12);
      sessionBuf.writeUInt32BE(0x80000000, 0);
      sessionBuf.writeUInt32BE(1280, 4);
      sessionBuf.writeUInt32BE(720, 8);
      mockStream.write(sessionBuf);

      const codec = await scrcpy.codec;
      const width = await scrcpy.width;
      const height = await scrcpy.height;

      expect(codec).to.equal('VP9');
      expect(width).to.equal(1280);
      expect(height).to.equal(720);

      mockStream.end();
      await streamPromise;
    });
  });

  describe('isRunning', () => {
    it('should return false initially, true when videoSocket is set, and false after stop()', () => {
      const scrcpy = new Scrcpy(dummyClient, { version: '4.1' });
      expect(scrcpy.isRunning()).to.be.false;

      const mockStream = new PassThrough();
      (scrcpy as any).videoSocket = new PromiseDuplex(mockStream);
      expect(scrcpy.isRunning()).to.be.true;

      expect(scrcpy.stop()).to.be.true;
      expect(scrcpy.isRunning()).to.be.false;
    });
  });

  describe('start', () => {
    const createMockClient = (videoStream: PassThrough): any => {
      const pkgPath = path.resolve('package.json');
      const pkgSize = fs.statSync(pkgPath).size;
      const shellStream = new PassThrough();
      shellStream.write('[server] INFO: Device: TestDevice\n');
      return {
        serial: 'dummy-serial',
        stat: async (p: string) => (p === '/data/local/tmp' ? { isDirectory: () => true } : { size: pkgSize }),
        push: async () => ({}),
        shell: async () => shellStream,
        openLocal2: async () => new PromiseDuplex(videoStream),
      };
    };

    it('should resolve without hanging when sendFrameMeta is false', async () => {
      const videoStream = new PassThrough();
      videoStream.write(Buffer.from([0x00]));
      const client = createMockClient(videoStream);

      const scrcpy = new Scrcpy(client, {
        version: '4.1',
        jarPath: path.resolve('package.json'),
        sendFrameMeta: false,
        control: false,
        tunnelDelay: 0,
      });

      const started = await scrcpy.start();
      expect(started).to.equal(scrcpy);
      expect(scrcpy.isRunning()).to.be.true;
      scrcpy.stop();
    });

    it('should reject instead of hanging when startStreamWithMeta errors before height is resolved', async () => {
      const videoStream = new PassThrough();
      videoStream.write(Buffer.from([0x00]));
      videoStream.end();
      const client = createMockClient(videoStream);

      const scrcpy = new Scrcpy(client, {
        version: '4.1',
        jarPath: path.resolve('package.json'),
        sendFrameMeta: true,
        control: false,
        tunnelDelay: 0,
      });

      let caught: Error | undefined;
      try {
        await scrcpy.start();
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).to.be.instanceOf(Error);
      expect(scrcpy.isRunning()).to.be.false;
    });
  });

  describe('recordToFile', () => {
    it('should call stop() in finally even when start() throws', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-rec-stop-'));
      const outPath = path.join(tmpDir, 'out.h264');
      const scrcpy = new Scrcpy(dummyClient, { version: '4.1' });
      const startStub = sinon.stub(scrcpy, 'start').rejects(new Error('boom during start'));
      const stopSpy = sinon.spy(scrcpy, 'stop');
      try {
        let caught: Error | undefined;
        try {
          await scrcpy.recordToFile(outPath, { remuxMp4: false });
        } catch (err) {
          caught = err as Error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(caught!.message).to.equal('boom during start');
        expect(stopSpy.calledOnce).to.be.true;
      } finally {
        startStub.restore();
        stopSpy.restore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should handle fileStream error events cleanly and reject without unhandled error', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-rec-err-'));
      const outPath = path.join(tmpDir, 'out.h264');
      const scrcpy = new Scrcpy(dummyClient, { version: '4.1' });

      const failingStream = new Writable({
        write(_chunk, _enc, cb) {
          cb(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
        },
      });
      const createWriteStreamStub = sinon.stub(fs, 'createWriteStream').returns(failingStream as any);
      const startStub = sinon.stub(scrcpy, 'start').callsFake(async () => {
        scrcpy.emit('frame', { keyframe: true, pts: 0n, data: new Uint8Array([1, 2, 3]) });
        return scrcpy;
      });
      const stopStub = sinon.stub(scrcpy, 'stop').callsFake(() => {
        (scrcpy as any)._setFatalError('stopped');
        return true;
      });

      try {
        let caught: Error | undefined;
        try {
          await scrcpy.recordToFile(outPath, { remuxMp4: false });
        } catch (err) {
          caught = err as Error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(caught!.message).to.include('EACCES');
      } finally {
        createWriteStreamStub.restore();
        startStub.restore();
        stopStub.restore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should pause videoSocket on backpressure and resume on drain', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-rec-bp-'));
      const outPath = path.join(tmpDir, 'out.h264');
      const scrcpy = new Scrcpy(dummyClient, { version: '4.1' });

      const fakeSocketStream = Object.assign(new EventEmitter(), {
        pause: sinon.spy(),
        resume: sinon.spy(),
        destroy: sinon.spy(),
      });
      (scrcpy as any).videoSocket = { stream: fakeSocketStream, destroy: sinon.spy() };

      const fakeFileStream = Object.assign(new EventEmitter(), {
        destroyed: false,
        writableEnded: false,
        write: sinon.stub().returns(false),
        end: sinon.spy(function (this: EventEmitter) {
          this.emit('finish');
        }),
      });
      const createWriteStreamStub = sinon.stub(fs, 'createWriteStream').returns(fakeFileStream as any);
      const startStub = sinon.stub(scrcpy, 'start').callsFake(async () => {
        scrcpy.emit('frame', { keyframe: true, pts: 0n, data: new Uint8Array([1, 2, 3]) });
        expect(fakeSocketStream.pause.calledOnce).to.be.true;
        fakeFileStream.emit('drain');
        expect(fakeSocketStream.resume.calledOnce).to.be.true;
        (scrcpy as any)._setFatalError('done');
        return scrcpy;
      });

      try {
        const res = await scrcpy.recordToFile(outPath, { remuxMp4: false });
        expect(res.frames).to.equal(1);
        expect(res.remuxError).to.be.undefined;
      } finally {
        createWriteStreamStub.restore();
        startStub.restore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should report remuxError on VideoRecordResult when ffmpeg remuxing fails', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-rec-remux-'));
      const outPath = path.join(tmpDir, 'out.mp4');
      const scrcpy = new Scrcpy(dummyClient, { version: '4.1' });

      const startStub = sinon.stub(scrcpy, 'start').callsFake(async () => {
        // Emit invalid h264 data so ffmpeg remuxing is guaranteed to fail (or ffmpeg missing)
        scrcpy.emit('frame', { keyframe: true, pts: 0n, data: new Uint8Array([0, 1, 2, 3]) });
        (scrcpy as any)._setFatalError('done');
        return scrcpy;
      });

      try {
        const res = await scrcpy.recordToFile(outPath, { remuxMp4: true });
        expect(res.filePath).to.equal(path.join(tmpDir, 'out.h264'));
        expect(res.remuxError).to.be.a('string').and.not.empty;
      } finally {
        startStub.restore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
