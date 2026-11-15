import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createClient, Utils } from '../src/index.js';

async function main(): Promise<void> {
  const client = createClient({ backend: 'native' });
  const devices = (await client.listDevices()).filter((device) => device.type === 'device');
  const selected = process.env.ADB_SERIAL
    ? devices.find((device) => device.id === process.env.ADB_SERIAL)
    : devices.length === 1 ? devices[0] : undefined;
  assert(selected, 'Connect exactly one authorized device or set ADB_SERIAL to select one');

  const device = selected.getClient();
  const id = randomUUID();
  const remotePath = `/data/local/tmp/adbkit-integration-${id}`;
  const remoteSocket = `localabstract:adbkit-integration-${id}`;
  const contents = Buffer.from(`adbkit integration ${id}\n`);
  let port: number | undefined;

  try {
    assert.equal((await device.execOut('echo adbkit-integration', 'utf8')).trim(), 'adbkit-integration');
    const push = await device.push(Readable.from([contents]), remotePath);
    await push.waitForEnd();
    assert.deepEqual(await Utils.readAll(await device.pull(remotePath)), contents);

    port = await device.tryForwardTCP(remoteSocket);
    assert((await device.listForwards()).some((forward) => forward.local === `tcp:${port}` && forward.remote === remoteSocket));
    await device.removeForward(`tcp:${port}`);
    port = undefined;
    assert(!(await device.listForwards()).some((forward) => forward.remote === remoteSocket));
    console.log(`Native ADB integration passed on ${selected.id}`);
  } finally {
    if (port !== undefined) await device.removeForward(`tcp:${port}`);
    await device.execOut(['rm', '-f', remotePath]);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
