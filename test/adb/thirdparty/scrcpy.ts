import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
      expect(parseScrcpyVersion('3.0')).to.deep.equal({ version: '3.0' });
      expect(parseScrcpyVersion('v3.0')).to.deep.equal({ version: '3.0' });
      expect(parseScrcpyVersion('2.7')).to.deep.equal({ version: '2.7' });
    });

    it('should parse GitHub release tag URL', () => {
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
});
