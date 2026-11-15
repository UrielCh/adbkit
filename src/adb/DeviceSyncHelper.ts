import { Readable } from 'node:stream';
import Sync from './sync.js';
import PullTransfer from './sync/pulltransfer.js';
import PushTransfer from './sync/pushtransfer.js';

/**
 * Run a one-off Sync operation and always close the Sync service afterwards.
 */
export async function withSync<T>(getSync: () => Promise<Sync>, fn: (sync: Sync) => Promise<T>): Promise<T> {
  const sync = await getSync();
  try {
    return await fn(sync);
  } finally {
    sync.end();
  }
}

/**
 * Start a Sync pull transfer and automatically close the Sync service when the transfer ends.
 */
export async function syncPull(getSync: () => Promise<Sync>, path: string): Promise<PullTransfer> {
  const sync = await getSync();
  let pullTransfer: PullTransfer;
  try {
    pullTransfer = await sync.pull(path);
  } catch (err) {
    sync.end();
    throw err;
  }
  void pullTransfer
    .waitForEnd()
    .catch(() => {})
    .finally(() => sync.end());
  return pullTransfer;
}

/**
 * Start a Sync push transfer and automatically close the Sync service when the transfer ends.
 */
export async function syncPush(
  getSync: () => Promise<Sync>,
  contents: string | Readable,
  path: string,
  mode?: number,
): Promise<PushTransfer> {
  const sync = await getSync();
  let transfer: PushTransfer;
  try {
    transfer = await sync.push(contents, path, mode);
  } catch (err) {
    sync.end();
    throw err;
  }
  void transfer
    .waitForEnd()
    .catch(() => {})
    .finally(() => sync.end());
  return transfer;
}
