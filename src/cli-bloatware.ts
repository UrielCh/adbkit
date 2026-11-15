import { program } from 'commander';
import DeviceClient from './adb/DeviceClient.js';
import { getClientDevice } from './cli-common.js';
import { stdin, stdout } from 'node:process';
import readlinePromises from 'node:readline/promises';

const BixbySet = new Set<string>(['com.samsung.android.app.spage', 'com.samsung.android.app.routines', 'com.samsung.android.visionintelligence']);

async function removeBloatware(serials: string[]): Promise<void> {
  const rl = readlinePromises.createInterface({
    input: stdin,
    output: stdout,
  });

  try {
    const devices = await getClientDevice(serials);
    const processDevice = async (device: DeviceClient) => {
      const pkgs = await device.listPackages();
      console.log(`${pkgs.length} Packages available`);
      let cnt = 0;
      const bixby = pkgs.filter((a) => a.name.includes('bixby') || BixbySet.has(a.name));
      if (bixby.length) {
        cnt++;
        console.log(`${bixby.length} bixby Packages`);
        for (const pkg of bixby) {
          console.log(`- ${pkg.name}`);
        }
        const r = await rl.question(`do you want to remove them ? [y/N]`);
        if (r.toLowerCase() == 'y' || r.toLowerCase() == 'yes') {
          for (const p of bixby) {
            console.log(`uninstalling ${p.name}`);
            try {
              await device.uninstall(p.name, { keep: true, user: 0, throwOnFailure: true });
              console.log('Success');
            } catch (err) {
              console.log(`Failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } else {
          console.log(`response: "${r}", Skip`);
        }
      }
      if (!cnt) {
        console.log('No bloatware, you may want to register some new bloatware in cli-bloatware.ts');
      } else {
        console.log(`${cnt} bloatware removed`);
      }
    };
    for (const device of devices) {
      await processDevice(device);
    }
  } finally {
    rl.close();
  }
}

program
  .command('bloatware [serials...]')
  .description('remove common bloatware.')
  .action(removeBloatware);

program
  .command('boatware [serials...]', { hidden: true })
  .description('Deprecated alias for bloatware.')
  .action(async (serials: string[]) => {
    console.warn('Warning: "boatware" command is deprecated, use "bloatware" instead.');
    await removeBloatware(serials);
  });
