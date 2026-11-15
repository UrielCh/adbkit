import Net from 'node:net';
import Utils from '../utils.js';
import { AdbLike, ForwardEntry } from './types.js';
import { bridgeNetAndAdbSocket } from './tcpBridge.js';

const debug = Utils.debug('adb:yawebadb');

/**
 * Manages local TCP port-forwarding servers backed by `ya-webadb` device sockets.
 */
export class YaWebAdbForwardManager {
  private forwards = new Map<string, ForwardEntry>();

  public get size(): number {
    return this.forwards.size;
  }

  public async addForward(
    serial: string,
    local: string,
    remote: string,
    getDeviceAdb: () => Promise<AdbLike>,
  ): Promise<void> {
    const key = `${serial}:${local}`;
    const existing = this.forwards.get(key);
    if (existing) {
      existing.remote = remote;
      return;
    }

    if (!local.startsWith('tcp:')) {
      throw new Error(`Unsupported local forward specification: ${local}`);
    }
    const localPort = parseInt(local.slice(4), 10);
    if (isNaN(localPort)) {
      throw new Error(`Invalid local TCP port in forward: ${local}`);
    }

    const entry: ForwardEntry = { serial, local, remote, server: Net.createServer() };
    const server = entry.server;
    server.on('connection', (clientSocket) => {
      const destination = entry.remote;
      void (async () => {
        try {
          const adb = await getDeviceAdb();
          const adbSocket = await adb.createSocket(destination);
          bridgeNetAndAdbSocket(clientSocket, adbSocket);
        } catch (err) {
          debug('Forward connection error (%s -> %s): %s', local, destination, (err as Error)?.message || err);
          clientSocket.destroy();
        }
      })();
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(localPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : localPort;
    const normalizedLocal = `tcp:${boundPort}`;
    entry.local = normalizedLocal;
    this.forwards.set(`${serial}:${normalizedLocal}`, entry);
  }

  public async killForward(serial: string, local: string): Promise<void> {
    const key = `${serial}:${local}`;
    const entry = this.forwards.get(key);
    if (!entry) {
      throw new Error(`listener '${local}' not found`);
    }
    this.forwards.delete(key);
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }

  public listForwards(serial?: string): Array<{ serial: string; local: string; remote: string }> {
    const result: Array<{ serial: string; local: string; remote: string }> = [];
    for (const entry of this.forwards.values()) {
      if (!serial || entry.serial === serial) {
        result.push({ serial: entry.serial, local: entry.local, remote: entry.remote });
      }
    }
    return result;
  }

  public closeAll(): void {
    for (const fwd of this.forwards.values()) {
      fwd.server.close();
    }
    this.forwards.clear();
  }
}
