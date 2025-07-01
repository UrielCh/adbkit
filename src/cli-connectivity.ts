import { program } from 'commander';
import DeviceClient from './adb/DeviceClient.js';
import { getClientDevice } from './cli-common.js';

for (const type of ['bluetooth', 'data', 'wifi'] as const) {
  program
    .command(`${type}-off [serials...]`)
    .description('Disable bluetooth.')
    .action(async (serials: string[]) => {
      const devices = await getClientDevice(serials);
      const process = async (device: DeviceClient) => {
        if (await device.extra.setSvc(type, false)) {
          console.log(`[${device.serial}] ${type} disabled`);
        } else {
          console.log(`[${device.serial}] failed ${type} already disabled`);
        }
      }
      await Promise.all(devices.map(process));
    });

  program
    .command(`${type}-on [serials...]`)
    .description('Enable bluetooth.')
    .action(async (serials: string[]) => {
      const devices = await getClientDevice(serials);
      const process = async (device: DeviceClient) => {
        if (await device.extra.setSvc(type, true)) {
          console.log(`[${device.serial}] ${type} enabled`);
        } else {
          console.log(`[${device.serial}] failed ${type} already enabled`);
        }
      }
      await Promise.all(devices.map(process));
    });
}
