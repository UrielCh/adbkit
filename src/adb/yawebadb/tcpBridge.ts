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

function waitForNetSocketDrain(netSocket: Net.Socket): Promise<boolean> {
  if (netSocket.destroyed || !netSocket.writable) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const cleanup = () => {
      netSocket.off('drain', onDrain);
      netSocket.off('close', onCloseOrError);
      netSocket.off('error', onCloseOrError);
    };
    const onDrain = () => {
      cleanup();
      resolve(true);
    };
    const onCloseOrError = () => {
      cleanup();
      resolve(false);
    };
    netSocket.once('drain', onDrain);
    netSocket.once('close', onCloseOrError);
    netSocket.once('error', onCloseOrError);
  });
}

/**
 * Bridge bidirectional data and lifecycle between a Node `net.Socket` and a `@yume-chan/adb` socket.
 */
export function bridgeNetAndAdbSocket(netSocket: Net.Socket, adbSocket: AdbSocketLike): void {
  const writer = adbSocket.writable.getWriter();
  const reader = adbSocket.readable.getReader();

  netSocket.on('data', (chunk: Buffer) => {
    const uint8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    netSocket.pause();
    writer.write(uint8).then(
      () => {
        if (!netSocket.destroyed) {
          netSocket.resume();
        }
      },
      () => {
        netSocket.destroy();
      },
    );
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
          const canContinue = netSocket.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
          if (!canContinue) {
            const drained = await waitForNetSocketDrain(netSocket);
            if (!drained) break;
          }
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
  let chunks: Buffer[] = [];
  let chunkIndex = 0;
  let headOffset = 0;
  let bufferedBytes = 0;
  let closed = false;
  let pendingRead: (() => void) | null = null;

  netSocket.on('data', (chunk: Buffer) => {
    if (chunk.length > 0) {
      chunks.push(chunk);
      bufferedBytes += chunk.length;
    }
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
    if (n === 0) {
      return new Uint8Array(0);
    }
    while (bufferedBytes < n) {
      if (closed) return null;
      await new Promise<void>((resolve) => {
        pendingRead = resolve;
      });
    }
    const first = chunks[chunkIndex]!;
    if (first.length - headOffset >= n) {
      const out = new Uint8Array(first.buffer, first.byteOffset + headOffset, n);
      headOffset += n;
      bufferedBytes -= n;
      if (headOffset === first.length) {
        chunkIndex += 1;
        headOffset = 0;
      }
      if (chunkIndex > 64 && chunkIndex * 2 >= chunks.length) {
        chunks = chunks.slice(chunkIndex);
        chunkIndex = 0;
      }
      return out;
    }
    const out = new Uint8Array(n);
    let written = 0;
    while (written < n) {
      const head = chunks[chunkIndex]!;
      const avail = head.length - headOffset;
      const toCopy = Math.min(avail, n - written);
      out.set(head.subarray(headOffset, headOffset + toCopy), written);
      written += toCopy;
      headOffset += toCopy;
      bufferedBytes -= toCopy;
      if (headOffset === head.length) {
        chunkIndex += 1;
        headOffset = 0;
      }
    }
    if (chunkIndex > 64 && chunkIndex * 2 >= chunks.length) {
      chunks = chunks.slice(chunkIndex);
      chunkIndex = 0;
    }
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
      const writeChunk = (chunk: Uint8Array) =>
        new Promise<void>((resolve, reject) => {
          netSocket.write(chunk, (err) => (err ? reject(err) : resolve()));
        });
      for (; ;) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        if ('tryConsume' in value && typeof value.tryConsume === 'function') {
          await value.tryConsume(writeChunk);
        } else {
          const chunk: Uint8Array = 'value' in value ? value.value : value;
          await writeChunk(chunk);
          if ('consume' in value && typeof value.consume === 'function') {
            value.consume();
          }
        }
      }
    } catch (err) {
      netSocket.destroy();
      await reader.cancel(err).catch(() => {});
    } finally {
      reader.releaseLock();
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
    const s = Net.connect({ host: host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host, port });
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

  try {
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
  } catch (err) {
    netSocket.destroy();
    throw err;
  }
}
