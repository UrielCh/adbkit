import { program } from 'commander';
import DeviceClient from './adb/DeviceClient.js';
import { forEachDevice, getClientDevice } from './cli-common.js';

for (const type of ['bluetooth', 'data', 'wifi'] as const) {
  program
    .command(`${type}-off [serials...]`)
    .description(`Disable ${type}.`)
    .action(async (serials: string[]) => {
      const devices = await getClientDevice(serials);
      const process = async (device: DeviceClient) => {
        const output = await device.extra.setSvc(type, false);
        if (!output.trim()) {
          console.log(`[${device.serial}] ${type} disabled`);
        } else {
          throw new Error(output.trim());
        }
      }
      await forEachDevice(devices, process);
    });

  program
    .command(`${type}-on [serials...]`)
    .description(`Enable ${type}.`)
    .action(async (serials: string[]) => {
      const devices = await getClientDevice(serials);
      const process = async (device: DeviceClient) => {
        const output = await device.extra.setSvc(type, true);
        if (!output.trim()) {
          console.log(`[${device.serial}] ${type} enabled`);
        } else {
          throw new Error(output.trim());
        }
      }
      await forEachDevice(devices, process);
    });
}
