import fs from 'node:fs';
import { program } from 'commander';
import forge from 'node-forge';
import { createClient } from './adb.js';
import Auth from './adb/auth.js';
import PacketReader from './adb/tcpusb/packetreader.js';
import path from 'node:path';
import Utils from './adb/utils.js';
import { getClientDevice } from './cli-common.js';

import './cli-airplane.js';
import './cli-connectivity.js';
import './cli-tethering.js';
import './cli-boatware.js'

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg: { version: string } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), { encoding: 'utf-8' }));

program.version(pkg.version);

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
        return process.exit(1);
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
  .option('-p, --port <port>', 'port number', (value: string) => String(value), '6174')
  .description('Provides an USB device over TCP using a translating proxy.')
  .action((serial: string, options: { port: string }) => {
    const adb = createClient();
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
  });

program
  .command('capture dest [serials...]')
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
      fs.writeFileSync(dest, capture);
    }
  });

program
  .command('dump <dest> [serials...]')
  .option('-v, --verbose', 'execute verbosely')
  .description('call uiautomator dump on the device and get the XML back')
  .action(async (dest: string, serials: string[], options: { verbose?: boolean }) => {
    const devices = await getClientDevice(serials);
    for (const device of devices) {
      if (options.verbose) console.log(`[${device.serial}] Generating dump...`);
      const output = await device.execOut('uiautomator dump', 'utf8');
      if (options.verbose) console.log(`[${device.serial}] ${output.trim()}`);

      let remotePath = '/sdcard/window_dump.xml';
      const match = output.match(/dumped to: \s*(\S+)/);
      if (match && match[1]) {
        remotePath = match[1];
      }

      let localPath = dest;
      if (devices.length > 1) {
        const ext = path.extname(localPath);
        const name = path.basename(localPath, ext);
        const dir = path.dirname(localPath);
        localPath = path.join(dir, `${name}-${device.serial}${ext}`);
      }

      if (options.verbose) console.log(`[${device.serial}] Pulling ${remotePath} to ${localPath}...`);

      const transfer = await device.pull(remotePath);
      const content = await Utils.readAll(transfer);
      const formatted = Utils.formatXml(content.toString('utf8'));
      fs.writeFileSync(localPath, formatted);

      if (options.verbose) console.log(`[${device.serial}] Done.`);
    }
  });

program.parse(process.argv);
