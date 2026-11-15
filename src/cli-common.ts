import { createClient, type AdbOptions } from './adb.js';
import { program } from 'commander';
import Device from './models/Device.js';
import DeviceClient from './adb/DeviceClient.js';

export function createCliClient() {
  return createClient(program.opts<AdbOptions>());
}

export async function getClientDevice(serials: string[]): Promise<DeviceClient[]> {
  const adb = createCliClient();
  if (!serials || !serials.length) {
    const devices: Device[] = await adb.listDevices();
    if (devices.length == 0) {
      console.error('no Android devices found');
      process.exit(1);
      return [];
    }
    if (devices.length == 1) {
      return [devices[0].getClient()];
    }
    console.error('Multiple devices available provide a serial number to choose one');
    console.error(devices.map(d => `- ${d.id}`).join('\n'));
    process.exit(1);
  }
  if (serials.length === 1 && (serials[0] === 'all' || serials[0] === '*')) {
    serials = (await adb.listDevices()).map((d: Device) => d.id);
  }
  return serials.map(serial => adb.getDevice(serial))
}

