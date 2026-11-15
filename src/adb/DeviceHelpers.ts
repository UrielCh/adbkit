import { Duplex } from 'node:stream';
import getPort from 'get-port';
import * as adbkitMonkey from '@u4/adbkit-monkey';
import Forward from '../models/Forward.js';
import Utils from './utils.js';

const { Monkey } = adbkitMonkey;

/**
 * Extract IPv4 followed by IPv6 addresses from `ip addr show` output.
 */
export function parseIpAddresses(ipData: string): string[] {
  const ipV4 = [...ipData.matchAll(/inet ([\d]+\.[\d]+\.[\d]+\.[\d]+)\/\d+/g)].map((m) => m[1]);
  const ipV6 = [...ipData.matchAll(/inet6 ([0-9a-f:]+)\/\d+/g)].map((m) => m[1]);
  return [...ipV4, ...ipV6];
}

/**
 * Reuse an existing TCP forward for `(serial, remote)` or create a new one on `preferedPort` or an available port.
 */
export async function findOrCreateTcpForward(params: {
  serial: string;
  remote: string;
  preferedPort?: number;
  listForwards: () => Promise<Forward[]>;
  forward: (local: string, remote: string) => Promise<boolean>;
}): Promise<number> {
  const { serial, remote, preferedPort, listForwards, forward } = params;
  const fwds = await listForwards();
  const serialFwds = fwds.filter((a) => a.serial === serial);
  for (const fwd of serialFwds) {
    if (fwd.remote === remote && fwd.local.startsWith('tcp:')) {
      const port = Number(fwd.local.substring(4));
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    }
  }

  const isPreferredPortInUse = preferedPort !== undefined && fwds.some((a) => a.local === `tcp:${preferedPort}`);
  if (preferedPort && !isPreferredPortInUse) {
    try {
      if (await forward(`tcp:${preferedPort}`, remote)) {
        return preferedPort;
      }
    } catch {
      // fall through to pick a free port
    }
  }

  const freePort = await getPort();
  await forward(`tcp:${freePort}`, remote);
  return freePort;
}

/**
 * Connect to an already-running Monkey TCP socket or launch Monkey on the device and connect with retries.
 */
export async function connectMonkeyStream(params: {
  port: number;
  openTcp: (port: number) => Promise<Duplex>;
  startMonkeyServer: (port: number) => Promise<Duplex>;
  debug: (msg: string) => void;
}): Promise<ReturnType<typeof Monkey.connectStream>> {
  const { port, openTcp, startMonkeyServer, debug } = params;
  const tryConnect = async (times: number): Promise<ReturnType<typeof Monkey.connectStream>> => {
    try {
      const stream: Duplex = await openTcp(port);
      return Monkey.connectStream(stream);
    } catch (err) {
      if ((times -= 1)) {
        debug(`Monkey can't be reached, trying ${times} more times`);
        await Utils.delay(100);
        return tryConnect(times);
      }
      throw err;
    }
  };

  try {
    return await tryConnect(1);
  } catch {
    const out = await startMonkeyServer(port);
    const monkey = await tryConnect(20);
    return monkey.once('end', () => out.end());
  }
}

/**
 * Check whether an `am start` / `am startservice` error indicates `--user` is unsupported on older Android versions.
 */
export function isNoUserOptionError(err: unknown): boolean {
  return err instanceof Error && err.message.indexOf('--user') !== -1;
}

/**
 * Execute an ActivityManager command (`am start` / `am startservice`) and retry without `--user`
 * if the device rejects `--user`. Does not mutate `options`.
 */
export async function startWithUserFallback<T extends { user?: number | null }>(
  options: T,
  defaultUser: number | undefined,
  execute: (opts: T) => Promise<boolean>,
): Promise<boolean> {
  const opts: T = defaultUser !== undefined && options.user === undefined
    ? { ...options, user: defaultUser }
    : options;
  try {
    return await execute(opts);
  } catch (err) {
    if (isNoUserOptionError(err) && opts.user !== undefined && opts.user !== null) {
      return await execute({ ...opts, user: undefined });
    }
    throw err;
  }
}
