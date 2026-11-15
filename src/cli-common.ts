import { createClient, type AdbOptions } from './adb.js';
import { program } from 'commander';
import Device from './models/Device.js';
import DeviceClient from './adb/DeviceClient.js';

export function createCliClient() {
  return createClient(program.opts<AdbOptions>());
}

export async function getClientDevice(serials: string[]): Promise<DeviceClient[]> {
  const adb = createCliClient();
  if (!serials || !serials.length || (serials.length === 1 && (serials[0] === 'all' || serials[0] === '*'))) {
    const devices: Device[] = await adb.listDevices();
    if (!devices.length) throw new Error('no Android devices found');
    if (!serials || !serials.length) {
      if (devices.length === 1) return [devices[0].getClient()];
      throw new Error(`Multiple devices available provide a serial number to choose one\n${devices.map(d => `- ${d.id}`).join('\n')}`);
    }
    return devices.map(d => d.getClient());
  }
  return serials.map(serial => adb.getDevice(serial));
}

/** Run every device operation and report failures with their serial numbers. */
export async function forEachDevice(devices: DeviceClient[], action: (device: DeviceClient) => Promise<void>): Promise<void> {
  const results = await Promise.allSettled(devices.map(device => action(device)));
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [`[${devices[index].serial}] ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (failures.length) throw new Error(failures.join('\n'));
}
