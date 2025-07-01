import { program } from 'commander';
import DeviceClient from './adb/DeviceClient.js';
import Utils from './adb/utils.js';
import { getClientDevice } from './cli-common.js';

program
  .command('airplane-mode-off [serials...]')
  .description('Disable airplane.')
  .action(async (serials: string[]) => {
    const devices = await getClientDevice(serials);
    const process = async (device: DeviceClient) => {
      if (await device.extra.airPlainMode(false)) {
        console.log(`[${device.serial}] airplane disabled`);
        await Utils.delay(100)
        await device.extra.back();
      } else {
        console.log(`[${device.serial}] airplane or already enabled`);
      }
    }
    await Promise.all(devices.map(process));
  });

program
  .command('airplane-mode-on-off [serials...]')
  .description('Enable then Disable airplane.')
  .action(async (serials: string[]) => {
    const devices = await getClientDevice(serials);
    const process = async (device: DeviceClient) => {
      if (await device.extra.airPlainMode(false, 200)) {
        console.log(`[${device.serial}] airplane on-off`);
        await Utils.delay(100)
        await device.extra.back();
      } else {
        console.log(`[${device.serial}] airplane or already enabled`);
      }
    }
    await Promise.all(devices.map(process));
  });

program
  .command('airplane-mode-on [serials...]')
  .description('Enable airplane.')
  .action(async (serials: string[]) => {
    const devices = await getClientDevice(serials);
    const process = async (device: DeviceClient) => {
      if (await device.extra.airPlainMode(true)) {
        console.log(`[${device.serial}] airplane enabled`);
        await Utils.delay(100)
        await device.extra.back();
      } else {
        console.log(`[${device.serial}] airplane or already enabled`);
      }
    }
    await Promise.all(devices.map(process));
  });

