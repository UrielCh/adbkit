import Net from 'node:net';
import { Buffer } from 'node:buffer';
import {
  AdbCredentialManagerLike,
  AdbLike,
  AdbModuleLike,
  AdbSocketLike,
  AdbTransportLike,
  ManagedDeviceInfo,
  sanitizeToken,
} from './types.js';

/**
 * Bridge bidirectional data and lifecycle between a Node `net.Socket` and a `@yume-chan/adb` socket.
 */
export function bridgeNetAndAdbSocket(netSocket: Net.Socket, adbSocket: AdbSocketLike): void {
  const writer = adbSocket.writable.getWriter();
  const reader = adbSocket.readable.getReader();

  netSocket.on('data', (chunk: Buffer) => {
    const uint8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    writer.write(uint8).catch(() => {
      netSocket.destroy();
    });
  });

  const closeAdb = () => void Promise.resolve(adbSocket.close()).catch(() => {});
  netSocket.on('end', () => {
    closeAdb();
    if (!netSocket.destroyed) {
      netSocket.end();
    }
  });

  netSocket.on('error', closeAdb);

  void (async () => {
    try {
      for (; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && !netSocket.destroyed) {
          netSocket.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        }
      }
    } catch {
      // ignore
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      if (!netSocket.destroyed) {
        netSocket.end();
      }
    }
  })();
}

/**
 * Wrap a Node `net.Socket` into a WebStreams packet connection compatible with `@yume-chan/adb`.
 */
export function createNetDaemonConnection(netSocket: Net.Socket, adbMod: AdbModuleLike): unknown {
  let buffer = Buffer.alloc(0);
  let closed = false;
  let pendingRead: (() => void) | null = null;

  netSocket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (pendingRead) {
      const resolve = pendingRead;
      pendingRead = null;
      resolve();
    }
  });

  const onEndOrError = () => {
    closed = true;
    if (pendingRead) {
      const resolve = pendingRead;
      pendingRead = null;
      resolve();
    }
  };
  netSocket.on('end', onEndOrError);
  netSocket.on('close', onEndOrError);
  netSocket.on('error', onEndOrError);

  const readBytes = async (n: number): Promise<Uint8Array | null> => {
    while (buffer.length < n) {
      if (closed) return null;
      await new Promise<void>((resolve) => {
        pendingRead = resolve;
      });
    }
    const out = new Uint8Array(buffer.buffer, buffer.byteOffset, n);
    buffer = buffer.subarray(n);
    return out;
  };

  const readable = new globalThis.ReadableStream({
    pull: async (controller) => {
      const headerBytes = await readBytes(24);
      if (!headerBytes) {
        controller.close();
        return;
      }
      const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, 24);
      const command = view.getUint32(0, true);
      const arg0 = view.getUint32(4, true);
      const arg1 = view.getUint32(8, true);
      const payloadLength = view.getUint32(12, true);
      const checksum = view.getUint32(16, true);
      const magic = view.getUint32(20, true);

      let payload: Uint8Array = new Uint8Array(0);
      if (payloadLength > 0) {
        const payloadBytes = await readBytes(payloadLength);
        if (!payloadBytes) {
          controller.close();
          return;
        }
        payload = payloadBytes;
      }
      controller.enqueue({ command, arg0, arg1, payloadLength, checksum, magic, payload });
    },
    cancel: () => {
      netSocket.destroy();
    },
  });

  const serializeStream = new adbMod.AdbPacketSerializeStream();
  const reader = serializeStream.readable.getReader();
  void (async () => {
    try {
      for (; ;) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const chunk: Uint8Array = 'value' in value ? value.value : value;
        await new Promise<void>((resolve, reject) => {
          netSocket.write(chunk, (err) => (err ? reject(err) : resolve()));
        });
      }
    } catch {
      // socket closed
    }
  })();

  return {
    readable,
    writable: serializeStream.writable,
  };
}

export interface ConnectTcpDeviceParams {
  host: string;
  port: number;
  adbMod: AdbModuleLike;
  credentialManager: AdbCredentialManagerLike;
  transportId: string;
  onDisconnected: (adbInstance: AdbLike) => void;
}

/**
 * Open and authenticate a TCP ADB daemon connection via `@yume-chan/adb`.
 */
export async function connectTcpDevice(params: ConnectTcpDeviceParams): Promise<ManagedDeviceInfo> {
  const { host, port, adbMod, credentialManager, transportId, onDisconnected } = params;
  const serial = `${host}:${port}`;

  const netSocket = await new Promise<Net.Socket>((resolve, reject) => {
    const s = Net.connect({ host, port });
    s.setNoDelay(true);
    const onError = (err: Error) => {
      s.off('connect', onConnect);
      reject(err);
    };
    const onConnect = () => {
      s.off('error', onError);
      resolve(s);
    };
    s.once('error', onError);
    s.once('connect', onConnect);
  });

  const connection = createNetDaemonConnection(netSocket, adbMod);
  const auth = adbMod.adbDaemonAuthenticate || adbMod.AdbDaemonTransport?.authenticate;
  if (!auth) {
    throw new Error('adbDaemonAuthenticate is not available');
  }
  const transport: AdbTransportLike = await auth({
    serial,
    connection,
    credentialManager,
    credentialStore: credentialManager,
  });
  const adbInstance: AdbLike = new adbMod.Adb(transport);

  const entry: ManagedDeviceInfo = {
    serial,
    state: 'device',
    path: `tcp:${host}:${port}`,
    product: sanitizeToken(adbInstance.banner?.product, 'unknown'),
    model: sanitizeToken(adbInstance.banner?.model, 'unknown'),
    device: sanitizeToken(adbInstance.banner?.device, 'unknown'),
    transportId,
    isTcp: true,
    detached: false,
    adb: adbInstance,
    cleanup: async () => {
      netSocket.destroy();
    },
  };

  void adbInstance.disconnected.finally(() => {
    onDisconnected(adbInstance);
  });

  return entry;
}
