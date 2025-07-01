import { createClient } from './adb.js';
import Device from './models/Device.js';
import DeviceClient from './adb/DeviceClient.js';

export async function getClientDevice(serials: string[]): Promise<DeviceClient[]> {
  const adb = createClient();
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
    console.error('Multiple devices avaliable provide a serial number to choose one');
    console.error(devices.map(d => `- ${d.id}`).join('\n'));
    process.exit(1);
  }
  if (serials.length === 1 && (serials[0] === 'all' || serials[0] === '*')) {
    serials = (await adb.listDevices()).map((d: Device) => d.id);
  }
  return serials.map(serial => adb.getDevice(serial))
}

