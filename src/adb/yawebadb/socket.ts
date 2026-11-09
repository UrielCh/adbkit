import { Duplex } from 'node:stream';
import Net from 'node:net';
import { Buffer } from 'node:buffer';
import Protocol from '../protocol.js';
import Utils from '../utils.js';
import { ClientOptions } from '../../models/ClientOptions.js';
import { AdbLike, AdbSocketLike, ManagedDeviceInfo } from './types.js';
import { YaWebAdbManager, bridgeNetAndAdbSocket } from './manager.js';

const debug = Utils.debug('adb:yawebadb');

/**
 * In-process Socket replacement backed by `YaWebAdbManager` (`@yume-chan/adb`).
 */
export class YaWebAdbSocket extends Duplex {
  private cmdBuffer: Buffer = Buffer.alloc(0);
  private streaming = false;
  private processingQueue: Promise<void> = Promise.resolve();
  private targetSerial?: string;
  private targetAdb?: AdbLike;
  private adbSocket?: AdbSocketLike;
  private adbWriter?: ReturnType<AdbSocketLike['writable']['getWriter']>;
  private cleanupHooks: Array<() => void> = [];
  private remoteEnded = false;
  private closedEmitted = false;
  private adbPort: number;

  constructor(public readonly options: ClientOptions = { port: 5037 }) {
    super();
    this.adbPort = typeof options.port === 'number' ? options.port : parseInt(String(options.port || 5037), 10) || 5037;
    YaWebAdbManager.getInstance().registerSocket(this);
    queueMicrotask(() => {
      if (!this.destroyed) {
        this.emit('connect');
      }
    });
  }

  public setNoDelay(_noDelay?: boolean): this {
    return this;
  }

  public setTimeout(_timeout: number, _callback?: () => void): this {
    return this;
  }

  public setKeepAlive(_enable?: boolean, _initialDelay?: number): this {
    return this;
  }

  public override _read(_size: number): void {
    // Data is pushed asynchronously by command handlers or adbSocket reader
  }

  public override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.processingQueue = this.processingQueue
      .then(() => this.processChunk(chunk))
      .then(
        () => callback(null),
        (err) => callback(err as Error),
      );
  }

  private async processChunk(chunk: Buffer): Promise<void> {
    if (this.streaming) {
      if (this.adbWriter) {
        const uint8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        await this.adbWriter.write(uint8);
      }
      return;
    }

    this.cmdBuffer = Buffer.concat([this.cmdBuffer, chunk]);
    while (!this.streaming && this.cmdBuffer.length >= 4) {
      const lenHex = this.cmdBuffer.subarray(0, 4).toString('ascii');
      const len = Protocol.decodeLength(lenHex);
      if (isNaN(len) || len < 0) {
        this.sendFail(`Invalid command length: ${lenHex}`);
        this.endRemote();
        return;
      }
      if (this.cmdBuffer.length < 4 + len) {
        break;
      }
      const cmd = this.cmdBuffer.subarray(4, 4 + len).toString('utf8');
      this.cmdBuffer = this.cmdBuffer.subarray(4 + len);
      await this.handleCommand(cmd);
    }

    if (this.streaming && this.cmdBuffer.length > 0 && this.adbWriter) {
      const leftover = this.cmdBuffer;
      this.cmdBuffer = Buffer.alloc(0);
      const uint8 = new Uint8Array(leftover.buffer, leftover.byteOffset, leftover.byteLength);
      await this.adbWriter.write(uint8);
    }
  }

  private pushData(data: Buffer | string): void {
    if (this.remoteEnded || this.destroyed) return;
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    this.push(buf);
  }

  private sendOkay(): void {
    this.pushData(Protocol.bOKAY);
  }

  private sendValue(val: string | Buffer): void {
    this.pushData(Protocol.encodeData(val));
  }

  private sendFail(message: string): void {
    this.pushData(Protocol.bFAIL);
    this.sendValue(message);
  }

  private endRemote(): void {
    if (!this.remoteEnded) {
      this.remoteEnded = true;
      this.push(null);
      YaWebAdbManager.getInstance().unregisterSocket(this);
    }
  }

  private async handleCommand(cmd: string): Promise<void> {
    debug('Command: %s (target=%s)', cmd, this.targetSerial || 'host');
    const manager = YaWebAdbManager.getInstance();

    try {
      // If we are already bound to a device transport, open a device service socket
      if (this.targetAdb) {
        await this.handleTransportService(this.targetAdb, cmd);
        return;
      }

      // Host commands
      if (cmd === 'host:version') {
        this.sendOkay();
        this.sendValue('0029');
        this.endRemote();
        return;
      }

      if (cmd === 'host:kill') {
        await manager.killAll();
        this.sendOkay();
        this.endRemote();
        return;
      }

      if (cmd === 'host:devices') {
        const devices = await manager.syncDevices(this.adbPort);
        const lines = devices
          .filter((d) => !d.detached)
          .map((d) => `${d.serial}\t${d.state}\n`)
          .join('');
        this.sendOkay();
        this.sendValue(lines);
        this.endRemote();
        return;
      }

      if (cmd === 'host:devices-l') {
        const devices = await manager.syncDevices(this.adbPort, true);
        const lines = devices
          .filter((d) => !d.detached)
          .map(
            (d) =>
              `${d.serial} ${d.state} ${d.path} product:${d.product} model:${d.model} device:${d.device} transport_id:${d.transportId}\n`,
          )
          .join('');
        this.sendOkay();
        this.sendValue(lines);
        this.endRemote();
        return;
      }

      if (cmd === 'host:track-devices') {
        const devices = await manager.syncDevices(this.adbPort);
        this.sendOkay();
        const formatList = (list: ManagedDeviceInfo[]) =>
          list
            .filter((d) => !d.detached)
            .map((d) => `${d.serial}\t${d.state}\n`)
            .join('');
        this.sendValue(formatList(devices));
        const unsub = await manager.addTracker((updated) => {
          this.sendValue(formatList(updated));
        }, this.adbPort);
        this.cleanupHooks.push(unsub);
        return;
      }

      if (cmd.startsWith('host:connect:')) {
        const rest = cmd.slice('host:connect:'.length);
        const [host, portStr] = rest.split(':');
        const port = parseInt(portStr || '5555', 10) || 5555;
        this.sendOkay();
        try {
          const status = await manager.connectTcp(host, port);
          if (status === 'already') {
            this.sendValue(`already connected to ${host}:${port}`);
          } else {
            this.sendValue(`connected to ${host}:${port}`);
          }
        } catch (err) {
          this.sendValue(`unable to connect to ${host}:${port}: ${(err as Error)?.message || err}`);
        }
        this.endRemote();
        return;
      }

      if (cmd.startsWith('host:disconnect:')) {
        const rest = cmd.slice('host:disconnect:'.length);
        const [host, portStr] = rest.split(':');
        const port = parseInt(portStr || '5555', 10) || 5555;
        this.sendOkay();
        const ok = await manager.disconnectTcp(host, port);
        if (ok) {
          this.sendValue(`disconnected ${host}:${port}`);
        } else {
          this.sendValue(`No such device ${host}:${port}`);
        }
        this.endRemote();
        return;
      }

      if (cmd.startsWith('host:transport:')) {
        const serial = cmd.slice('host:transport:'.length);
        const adb = await manager.getDeviceAdb(serial, this.adbPort);
        this.targetSerial = serial;
        this.targetAdb = adb;
        this.sendOkay();
        return;
      }

      if (cmd === 'host:list-forward') {
        const list = manager
          .listForwards()
          .map((f) => `${f.serial} ${f.local} ${f.remote}\n`)
          .join('');
        this.sendOkay();
        this.sendValue(list);
        this.endRemote();
        return;
      }

      // host-serial:<serial>:<subcommand>
      if (cmd.startsWith('host-serial:')) {
        const withoutPrefix = cmd.slice('host-serial:'.length);
        const colonIdx = withoutPrefix.indexOf(':');
        if (colonIdx === -1) {
          this.sendFail(`Malformed host-serial command: ${cmd}`);
          this.endRemote();
          return;
        }
        const serial = withoutPrefix.slice(0, colonIdx);
        const subCmd = withoutPrefix.slice(colonIdx + 1);
        await this.handleHostSerialCommand(manager, serial, subCmd);
        return;
      }

      this.sendFail(`Unsupported host command: ${cmd}`);
      this.endRemote();
    } catch (err) {
      debug('Command %s failed: %s', cmd, (err as Error)?.message || err);
      this.sendFail((err as Error)?.message || String(err));
      this.endRemote();
    }
  }

  private async handleHostSerialCommand(manager: YaWebAdbManager, serial: string, subCmd: string): Promise<void> {
    const done = () => {
      this.sendOkay();
      this.endRemote();
    };
    const sendOkayValue = (val: string) => {
      this.sendOkay();
      this.sendValue(val);
      this.endRemote();
    };

    const infoProps: Record<string, 'serial' | 'path' | 'state'> = {
      'get-serialno': 'serial',
      'get-devpath': 'path',
      'get-state': 'state',
    };
    const prop = infoProps[subCmd];
    if (prop) {
      const info = await manager.getDeviceInfo(serial, this.adbPort);
      return sendOkayValue(info[prop]);
    }

    if (subCmd.startsWith('wait-for-')) {
      this.sendOkay();
      const isMatch = (d: ManagedDeviceInfo) => d.serial === serial && d.state === 'device' && !d.detached;
      const devices = await manager.syncDevices(this.adbPort);
      if (devices.some(isMatch)) return done();

      const unsub = await manager.addTracker((list) => {
        if (list.some(isMatch)) {
          unsub();
          done();
        }
      }, this.adbPort);
      this.cleanupHooks.push(unsub);
      return;
    }

    if (subCmd.startsWith('forward:') || subCmd.startsWith('killforward:')) {
      if (subCmd.startsWith('forward:')) {
        const [local, remote] = subCmd.replace(/^forward:(norebind:)?/, '').split(';');
        await manager.addForward(serial, local, remote, this.adbPort);
      } else {
        await manager.killForward(serial, subCmd.slice('killforward:'.length));
      }
      this.sendOkay();
      return done();
    }

    if (subCmd === 'list-forward') {
      const list = manager
        .listForwards(serial)
        .map((f) => `${f.serial} ${f.local} ${f.remote}\n`)
        .join('');
      return sendOkayValue(list);
    }

    if (subCmd === 'attach' || subCmd === 'detach') {
      await (subCmd === 'attach'
        ? manager.attachDevice(serial, this.adbPort)
        : manager.detachDevice(serial, this.adbPort));
      return done();
    }

    this.sendFail(`Unsupported host-serial command: ${subCmd}`);
    this.endRemote();
  }

  private async handleTransportService(adb: AdbLike, service: string): Promise<void> {
    // Register reverse tunnel handler on the host if requested
    if (service.startsWith('reverse:forward:')) {
      let spec = service.slice('reverse:forward:'.length);
      if (spec.startsWith('norebind:')) {
        spec = spec.slice('norebind:'.length);
      }
      const [, local] = spec.split(';');
      if (local) {
        try {
          await adb.transport.removeReverseTunnel(local);
        } catch {
          // ignore
        }
        await adb.transport.addReverseTunnel((incomingAdbSocket) => {
          if (local.startsWith('tcp:')) {
            const port = parseInt(local.slice(4), 10);
            const netSocket = Net.connect({ host: '127.0.0.1', port });
            bridgeNetAndAdbSocket(netSocket, incomingAdbSocket);
          } else if (local.includes(':')) {
            const sockPath = local.slice(local.indexOf(':') + 1);
            const netSocket = Net.connect(sockPath);
            bridgeNetAndAdbSocket(netSocket, incomingAdbSocket);
          } else {
            void Promise.resolve(incomingAdbSocket.close()).catch(() => {});
          }
        }, local);
        YaWebAdbManager.getInstance().markReverseTunnelAdded();
      }
    }

    const adbSocket = await adb.createSocket(service);
    this.adbSocket = adbSocket;
    this.adbWriter = adbSocket.writable.getWriter();
    this.streaming = true;
    this.sendOkay();

    const reader = adbSocket.readable.getReader();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && !this.remoteEnded && !this.destroyed) {
            this.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
          }
        }
      } catch (err) {
        debug('ADB socket read ended for %s: %s', service, (err as Error)?.message || err);
      } finally {
        reader.releaseLock();
        this.endRemote();
      }
    })();
  }

  private cleanup(): void {
    while (this.cleanupHooks.length > 0) {
      const fn = this.cleanupHooks.pop();
      try {
        fn?.();
      } catch {
        // ignore
      }
    }
    if (this.adbWriter) {
      try {
        this.adbWriter.releaseLock();
      } catch {
        // ignore
      }
      this.adbWriter = undefined;
    }
    if (this.adbSocket) {
      const sock = this.adbSocket;
      this.adbSocket = undefined;
      void Promise.resolve(sock.close()).catch(() => {});
    }
    this.endRemote();
    YaWebAdbManager.getInstance().unregisterSocket(this);
    if (!this.closedEmitted) {
      this.closedEmitted = true;
      queueMicrotask(() => this.emit('close', false));
    }
  }

  public override end(...args: any[]): this {
    this.cleanup();
    return (Duplex.prototype.end as any).apply(this, args);
  }

  public override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.cleanup();
    callback(error);
  }
}

