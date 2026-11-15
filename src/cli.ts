import fs from 'node:fs';
import { InvalidArgumentError, Option, program } from 'commander';
import forge from 'node-forge';
import Auth from './adb/auth.js';
import PacketReader from './adb/tcpusb/packetreader.js';
import path from 'node:path';
import Utils from './adb/utils.js';
import { createCliClient, getClientDevice } from './cli-common.js';

import './cli-airplane.js';
import './cli-connectivity.js';
import './cli-tethering.js';
import './cli-bloatware.js';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg: { version: string } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), { encoding: 'utf-8' }));

function parsePort(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new InvalidArgumentError('Port must be an integer between 1 and 65535.');
  }
  return Number(value);
}

program.version(pkg.version)
  .option('--host <host>', 'ADB server host')
  .option('--port <port>', 'ADB server port', parsePort)
  .addOption(new Option('--backend <backend>', 'ADB backend').choices(['auto', 'native', 'ya-webadb']));

program
  .command('pubkey-convert <file>')
  .option('-f, --format <format>', 'format (pem or openssh)', String, 'pem')
  .description('Converts an ADB-generated public key into PEM format.')
  .action(async (file, options): Promise<void> => {
    const key = await Auth.parsePublicKey(fs.readFileSync(file).toString('utf8'));
    switch (options.format.toLowerCase()) {
      case 'pem':
        return console.log(forge.pki.publicKeyToPem(key).trim());
      case 'openssh':
        return console.log(forge.ssh.publicKeyToOpenSSH(key, 'adbkey').trim());
      default:
        console.error("Unsupported format '" + options.format + "'");
        process.exitCode = 1;
        return;
    }
  });

program
  .command('pubkey-fingerprint <file>')
  .description('Outputs the fingerprint of an ADB-generated public key.')
  .action(async (file: string) => {
    const key = await Auth.parsePublicKey(fs.readFileSync(file).toString('utf8'));
    return console.log('%s %s', key.fingerprint, key.comment);
  });

program
  .command('usb-device-to-tcp <serial>')
  .option('-p, --port <port>', 'port number', parsePort, 6174)
  .description('Provides an USB device over TCP using a translating proxy.')
  .action((serial: string, options: { port: number }) => {
    const adb = createCliClient();
    const server = adb
      .createTcpUsbBridge(serial, {
        auth: () => Promise.resolve(),
      })
      .on('listening', () => console.info('Connect with `adb connect localhost:%d`', options.port))
      .on('error', (err) => console.error('An error occured: ' + err.message));
    server.listen(options.port);
  });

program
  .command('parse-tcp-packets <file>')
  .description('Parses ADB TCP packets from the given file.')
  .action((file: string) => {
    const reader = new PacketReader(fs.createReadStream(file));
    reader.on('packet', (packet) => console.log(packet.toString()));
    reader.on('error', (err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
  });


program
  .command('capture <dest> [serials...]')
  .description('capture screen of one or many device as png.')
  .action(async (dest: string, serials: string[]) => {
    const devices = await getClientDevice(serials);
    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      let out = dest;
      if (devices.length > 1) {
        out = path.join(path.dirname(out), device.serial + '-' + path.basename(out));
      }
      const stream = await device.screencap();
      const capture = await Utils.readAll(stream);
      await fs.promises.writeFile(out, capture);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
