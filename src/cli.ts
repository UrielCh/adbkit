import fs from 'fs';
import { program } from 'commander';
import forge from 'node-forge';
import * as pkg from '../package.json';
import Adb from './adb';
import Auth from './adb/auth';
import PacketReader from './adb/tcpusb/packetreader';

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
  .action((serial: string, options: {port: string}) => {
    const adb = Adb.createClient();
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

program.parse(process.argv);
