import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { DeviceClientOptions } from '../models/DeviceClientOptions.js';
import type WithToString from '../models/WithToString.js';
import Connection from './connection.js';
import InstallCommand from './command/host-transport/install.js';
import Sync from './sync.js';
import PushTransfer from './sync/pushtransfer.js';
import type DeviceClient from './DeviceClient.js';
import DevicePackage from './DevicePackage.js';

/**
 * Push a local or streamed APK to a unique device temp path and install it.
 */
export async function installApk(params: {
  apk: string | Readable;
  push: (contents: string | Readable, path: string) => Promise<PushTransfer>;
  installRemote: (remotePath: string) => Promise<boolean>;
}): Promise<boolean> {
  const { apk, push, installRemote } = params;
  const temp = Sync.temp(typeof apk === 'string' ? apk : `_stream_${randomUUID()}.apk`);
  const transfer = await push(apk, temp);
  await transfer.waitForEnd();
  return installRemote(temp);
}

/**
 * Install an APK already present on the device and always clean up the remote temp file.
 */
export async function installRemoteApk(params: {
  apk: string;
  getTransport: () => Promise<Connection>;
  options: DeviceClientOptions;
  execOut: (command: ArrayLike<WithToString>) => Promise<unknown>;
  debug: (msg: string) => void;
}): Promise<boolean> {
  const { apk, getTransport, options, execOut, debug } = params;
  const transport = await getTransport();
  let installError: unknown;
  let hasInstallError = false;
  try {
    await new InstallCommand(transport, options).execute(apk);
  } catch (err) {
    installError = err;
    hasInstallError = true;
    transport.end();
  }
  try {
    await execOut(['rm', '-f', apk]);
  } catch (cleanupErr) {
    debug(`Failed to remove temporary APK '${apk}': ${cleanupErr}`);
    if (!hasInstallError) {
      throw cleanupErr;
    }
  }
  if (hasInstallError) {
    throw installError;
  }
  return true;
}

/**
 * List installed packages wrapped as `DevicePackage` instances.
 */
export async function listDevicePackages(
  client: DeviceClient,
  getPackages: (...flags: string[]) => Promise<string[]>,
  options?: { thirdparty?: boolean },
): Promise<DevicePackage[]> {
  const packages = options?.thirdparty ? await getPackages('-3') : await getPackages();
  return packages.map((name) => new DevicePackage(client, name));
}
