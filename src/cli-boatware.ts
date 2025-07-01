import { program } from 'commander';
import DeviceClient from './adb/DeviceClient.js';
import { getClientDevice } from './cli-common.js';
import { stdin, stdout } from 'node:process';
import readlinePromises from 'node:readline/promises';

const BixbySet = new Set<string>(['com.samsung.android.app.spage', 'com.samsung.android.app.routines', 'com.samsung.android.visionintelligence']);

program
  .command(`boatware [serials...]`)
  .description('remove common boatware.')
  .action(async (serials: string[]) => {

    const rl = readlinePromises.createInterface({
      input: stdin,
      output: stdout
    });

    const devices = await getClientDevice(serials);
    const process = async (device: DeviceClient) => {
      const pkgs = await device.listPackages();
      console.log(`${pkgs.length} Packages availible`);
      let cnt = 0;
      // const samsung = pkgs.filter(a => a.name.startsWith('com.samsung'))
      // samsung.forEach(a => console.log(a.name));
      const bixby = pkgs.filter(a => a.name.includes('bixby') || BixbySet.has(a.name))
      if (bixby.length) {
        cnt++;
        console.log(`${bixby.length} bixby Packages`);
        for (const pkg of bixby) {
          console.log(`- ${pkg.name}`)
        }
        const r = await rl.question(`do you want to remove them ? [y/N]`);
        if (r.toLowerCase() == 'y' || r.toLowerCase() == 'yes') {
          for (const p of bixby) {
            console.log(`uninstalling ${p.name}`)
            const r = await device.uninstall(p.name, {keep: true, user: 0});
            console.log(r ? 'Success': 'Failed')            
          }
        } else {
          console.log(`response: "${r}", Skip`);
        }
      }
      if (!cnt) {
        console.log('No boatware, you may want to register some new boatware in cli-boatware.ts');
      } else {
        console.log(`${cnt} boatware removed`);
      }
    }
    for (const device of devices) {
      await process(device);
    }
    rl.close();
  });