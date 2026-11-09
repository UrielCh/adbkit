import { downloadScrcpyServer, parseScrcpyVersion } from '../src/adb/thirdparty/scrcpy/ScrcpyDownload.js';

async function main() {
  const arg1 = process.argv[2] || 'https://github.com/Genymobile/scrcpy/releases/tag/v3.0';
  const destPath = process.argv[3];
  const force = process.argv.includes('--force') || process.argv.includes('-f');

  const { version } = parseScrcpyVersion(arg1);
  console.log(`Downloading scrcpy-server v${version} from ${arg1}...`);

  const file = await downloadScrcpyServer(arg1, {
    destPath,
    force,
    onProgress: (downloaded, total) => {
      if (total) {
        const percent = ((downloaded / total) * 100).toFixed(1);
        process.stdout.write(`\rProgress: ${percent}% (${downloaded}/${total} bytes)`);
      } else {
        process.stdout.write(`\rDownloaded: ${downloaded} bytes`);
      }
    },
  });

  console.log(`\nSuccessfully downloaded scrcpy-server v${version} to:\n${file}`);
}

main().catch((err) => {
  console.error('\nError downloading scrcpy-server:', err);
  process.exit(1);
});

