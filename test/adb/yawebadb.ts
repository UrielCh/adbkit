import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import Net from 'node:net';
import Adb, {
  Client,
  isYaWebAdbAvailable,
  setYaWebAdbLoader,
  YaWebAdbManager,
  YaWebAdbModules,
  YaWebAdbSocket,
} from '../../src/index.js';
import { bridgeNetAndAdbSocket, createNetDaemonConnection } from '../../src/adb/yawebadb/tcpBridge.js';
import type { AdbModuleLike, AdbSocketLike, AdbTransportLike, WebUsbDeviceLike } from '../../src/adb/yawebadb/types.js';

use(sinonChai);

function createMockYaWebAdbModules() {
  const createdSockets: Array<{ service: string; written: Uint8Array[] }> = [];
  const listeners = new Set<(devices: readonly WebUsbDeviceLike[]) => void>();

  const mockUsbDevices = [
    {
      serial: 'MOCK_SERIAL_1',
      name: 'Mock Phone 1',
      raw: {
        bus: 1,
        address: 2,
        productName: 'Mock Phone 1',
        opened: false,
        close: async () => {},
      },
      connect: async () => ({
        readable: new globalThis.ReadableStream(),
        writable: new globalThis.WritableStream(),
      }),
    },
  ];

  class MockAdb {
    public serial: string;
    public banner = {
      product: 'mock_prod',
      model: 'Mock_Model',
      device: 'mock_dev',
      features: ['shell_v2', 'cmd', 'stat_v2', 'ls_v2'],
    };
    public disconnected = new Promise<void>(() => {});
    public transport: AdbTransportLike;

    constructor(transport: AdbTransportLike) {
      this.transport = transport;
      this.serial = String(transport.serial || 'MOCK_SERIAL_1');
    }

    async createSocket(service: string) {
      if (service === 'fail:service') {
        throw new Error('service failed on device');
      }
      const written: Uint8Array[] = [];
      createdSockets.push({ service, written });

      let replyData = new Uint8Array(0);
      if (service === 'shell:echo hello') {
        replyData = new Uint8Array(Buffer.from('hello\n'));
      } else if (service === 'shell:getprop') {
        replyData = new Uint8Array(Buffer.from('[ro.product.model]: [Mock_Model]\n'));
      } else if (service.startsWith('reverse:forward:')) {
        replyData = new Uint8Array(Buffer.from('OKAY'));
      } else if (service === 'reverse:list-forward') {
        const body = 'Mock_Serial tcp:8080 tcp:3000\n';
        const lenHex = body.length.toString(16).padStart(4, '0');
        replyData = new Uint8Array(Buffer.from(`${lenHex}${body}`));
      }

      let readDone = false;
      return {
        service,
        closed: Promise.resolve(undefined),
        readable: {
          getReader: () => ({
            read: async () => {
              if (!readDone && replyData.length > 0) {
                readDone = true;
                return { done: false, value: replyData };
              }
              return { done: true, value: undefined };
            },
            releaseLock: () => {},
            cancel: async () => {},
          }),
        },
        writable: {
          getWriter: () => ({
            write: async (chunk: Uint8Array) => {
              written.push(chunk);
            },
            close: async () => {},
            abort: async () => {},
            releaseLock: () => {},
          }),
        },
        close: async () => {},
      };
    }

    async close() {}
  }

  const modules: YaWebAdbModules = {
    adb: {
      Adb: MockAdb,
      adbDaemonAuthenticate: async ({ serial }: { serial: string }) => ({
        serial,
        maxPayloadSize: 65536,
        banner: {
          product: 'mock_prod',
          model: 'Mock_Model',
          device: 'mock_dev',
          features: ['shell_v2', 'cmd'],
        },
        disconnected: new Promise<void>(() => {}),
        clientFeatures: ['shell_v2', 'cmd'],
        connect: async () => ({
          service: '',
          closed: Promise.resolve(undefined),
          readable: new globalThis.ReadableStream(),
          writable: new globalThis.WritableStream(),
          close: async () => {},
        }),
        addReverseTunnel: async () => 'tcp:3000',
        removeReverseTunnel: async () => {},
        clearReverseTunnels: async () => {},
        close: async () => {},
      }),
      AdbPacketSerializeStream: class {
        readable = new globalThis.ReadableStream();
        writable = new globalThis.WritableStream();
      },
    },
    webusb: {
      AdbDaemonWebUsbDeviceManager: class {
        async getDevices() {
          return mockUsbDevices;
        }
        async trackDevices() {
          return {
            current: mockUsbDevices,
            onDeviceAdd: () => () => {},
            onDeviceRemove: () => () => {},
            onListChange: (cb: (devs: readonly WebUsbDeviceLike[]) => void) => {
              listeners.add(cb);
              return () => {
                listeners.delete(cb);
              };
            },
            close: () => {
              listeners.clear();
            },
          };
        }
      },
    },
    credentialNodejs: {
      TangoNodeJsStorage: class {
        async save(): Promise<undefined> {
          return undefined;
        }
        async *load(): AsyncGenerator<never, void, void> {}
      },
      AdbWebCryptoCredentialManager: class {},
    },
    usb: {
      usb: {},
    },
  };

  return { modules, mockUsbDevices, createdSockets, listeners };
}

describe('ya-webadb integration', () => {
  afterEach(() => {
    setYaWebAdbLoader(null);
    YaWebAdbManager.resetInstance();
  });

  it('should detect ya-webadb optional dependencies when installed', async () => {
    const available = await isYaWebAdbAvailable();
    expect(available).to.be.true;
  });

  it('should report unavailable when optional dependencies fail to load', async () => {
    setYaWebAdbLoader(async () => null);
    const available = await isYaWebAdbAvailable();
    expect(available).to.be.false;
  });

  it('should use YaWebAdbSocket by default when ya-webadb is available', async () => {
    const { modules } = createMockYaWebAdbModules();
    setYaWebAdbLoader(async () => modules);

    const client = Adb.createClient();
    const conn = await client.connection();
    expect(conn.getSocket()).to.be.instanceOf(YaWebAdbSocket);
    conn.end();
  });

  it('should support host:version, host:devices, and host:devices-l via ya-webadb', async () => {
    const { modules } = createMockYaWebAdbModules();
    setYaWebAdbLoader(async () => modules);

    const client = Adb.createClient();
    const version = await client.version();
    expect(version).to.equal(0x29);

    const devices = await client.listDevices();
    expect(devices).to.have.lengthOf(1);
    expect(devices[0].id).to.equal('MOCK_SERIAL_1');
    expect(devices[0].type).to.equal('device');

    const devicesWithPaths = await client.listDevicesWithPaths();
    expect(devicesWithPaths).to.have.lengthOf(1);
    expect(devicesWithPaths[0].id).to.equal('MOCK_SERIAL_1');
    expect(devicesWithPaths[0].path).to.equal('usb:1:2');
    expect(devicesWithPaths[0].product).to.equal('mock_prod');
    expect(devicesWithPaths[0].model).to.equal('Mock_Model');
    expect(devicesWithPaths[0].device).to.equal('mock_dev');
  });

  it('should support host-serial and transport commands on DeviceClient via ya-webadb', async () => {
    const { modules, createdSockets } = createMockYaWebAdbModules();
    setYaWebAdbLoader(async () => modules);

    const client: Client = Adb.createClient();
    const device = client.getDevice('MOCK_SERIAL_1');

    expect(await device.getSerialNo()).to.equal('MOCK_SERIAL_1');
    expect(await device.getDevicePath()).to.equal('usb:1:2');
    expect(await device.getState()).to.equal('device');
    expect(await device.waitForDevice()).to.equal('MOCK_SERIAL_1');

    const props = await device.getProperties();
    expect(props['ro.product.model']).to.equal('Mock_Model');

    const shellStream = await device.shell('echo hello');
    const output = await Adb.util.readAll(shellStream);
    expect(output.toString()).to.equal('hello\n');
    expect(createdSockets.some((s) => s.service === 'shell:echo hello')).to.be.true;

    await device.reverse('tcp:8080', 'tcp:3000');
    const reverses = await device.listReverses();
    expect(reverses).to.deep.equal([{ remote: 'tcp:8080', local: 'tcp:3000' }]);
  });

  it('should support port forwarding (forward, listForwards, removeForward) via ya-webadb', async () => {
    const { modules, createdSockets } = createMockYaWebAdbModules();
    setYaWebAdbLoader(async () => modules);

    const client = Adb.createClient();
    const device = client.getDevice('MOCK_SERIAL_1');

    const port = await device.tryForwardTCP('localabstract:test_sock');
    expect(port).to.be.a('number').and.above(0);

    const forwards = await device.listForwards();
    expect(forwards).to.deep.equal([
      {
        serial: 'MOCK_SERIAL_1',
        local: `tcp:${port}`,
        remote: 'localabstract:test_sock',
      },
    ]);

    // Connect to the forwarded local TCP port and verify it opens the remote ADB socket
    await new Promise<void>((resolve, reject) => {
      const sock = Net.connect({ host: '127.0.0.1', port }, () => {
        sock.end(Buffer.from('ping'));
      });
      sock.on('close', () => resolve());
      sock.on('error', reject);
    });

    expect(createdSockets.some((s) => s.service === 'localabstract:test_sock')).to.be.true;

    await device.removeForward(`tcp:${port}`);
    expect(await device.listForwards()).to.deep.equal([]);
  });

  it('should support detach and attach via ya-webadb', async () => {
    const { modules } = createMockYaWebAdbModules();
    setYaWebAdbLoader(async () => modules);

    const client = Adb.createClient();
    const device = client.getDevice('MOCK_SERIAL_1');

    expect(await client.listDevices()).to.have.lengthOf(1);
    await device.detach();
    expect(await client.listDevices()).to.have.lengthOf(0);
    await device.attach();
    expect(await client.listDevices()).to.have.lengthOf(1);
  });

  describe('tcpBridge', () => {
    it('createNetDaemonConnection should reassemble fragmented and multi-chunk packets cleanly', async () => {
      const mockSocket = new EventEmitter() as unknown as Net.Socket;
      mockSocket.destroy = (() => mockSocket) as Net.Socket['destroy'];
      mockSocket.write = ((_data: unknown, cb?: (err?: Error | null) => void) => {
        cb?.(null);
        return true;
      }) as unknown as Net.Socket['write'];

      const mockAdbMod = {
        AdbPacketSerializeStream: class {
          readable = new globalThis.ReadableStream();
          writable = new globalThis.WritableStream();
        },
      } as unknown as AdbModuleLike;

      const conn = createNetDaemonConnection(mockSocket, mockAdbMod) as {
        readable: ReadableStream<{
          command: number;
          arg0: number;
          arg1: number;
          payloadLength: number;
          checksum: number;
          magic: number;
          payload: Uint8Array;
        }>;
      };

      const makePacket = (cmd: number, payload: Buffer) => {
        const hdr = Buffer.alloc(24);
        hdr.writeUInt32LE(cmd, 0);
        hdr.writeUInt32LE(1, 4);
        hdr.writeUInt32LE(2, 8);
        hdr.writeUInt32LE(payload.length, 12);
        hdr.writeUInt32LE(0x1234, 16);
        hdr.writeUInt32LE((~cmd) >>> 0, 20);
        return Buffer.concat([hdr, payload]);
      };

      const p1Payload = Buffer.alloc(200, 0xaa);
      const p2Payload = Buffer.alloc(0);
      const p3Payload = Buffer.from('hello-yawebadb-chunk-queue');
      const combined = Buffer.concat([
        makePacket(0x4e584e43, p1Payload),
        makePacket(0x4e45504f, p2Payload),
        makePacket(0x45545257, p3Payload),
      ]);

      // Feed data in tiny uneven slices (7 bytes at a time) across chunk boundaries
      for (let i = 0; i < combined.length; i += 7) {
        mockSocket.emit('data', combined.subarray(i, i + 7));
      }
      mockSocket.emit('end');

      const reader = conn.readable.getReader();
      const packets = [];
      for (; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        packets.push(value);
      }

      expect(packets).to.have.lengthOf(3);
      expect(packets[0].command).to.equal(0x4e584e43);
      expect(Buffer.from(packets[0].payload)).to.deep.equal(p1Payload);
      expect(packets[1].command).to.equal(0x4e45504f);
      expect(packets[1].payload.length).to.equal(0);
      expect(packets[2].command).to.equal(0x45545257);
      expect(Buffer.from(packets[2].payload)).to.deep.equal(p3Payload);
    });

    it('bridgeNetAndAdbSocket should wait for drain when netSocket.write returns false', async () => {
      const mockNetSocket = new EventEmitter() as unknown as Net.Socket;
      mockNetSocket.destroyed = false;
      mockNetSocket.writable = true;
      mockNetSocket.pause = (() => mockNetSocket) as Net.Socket['pause'];
      mockNetSocket.resume = (() => mockNetSocket) as Net.Socket['resume'];
      mockNetSocket.destroy = (() => {
        mockNetSocket.destroyed = true;
        return mockNetSocket;
      }) as Net.Socket['destroy'];
      let ended = false;
      mockNetSocket.end = (() => {
        ended = true;
        return mockNetSocket;
      }) as unknown as Net.Socket['end'];

      const writtenToNet: Buffer[] = [];
      let allowWrite = false;
      mockNetSocket.write = ((chunk: Buffer) => {
        writtenToNet.push(chunk);
        return allowWrite;
      }) as unknown as Net.Socket['write'];

      let pulls = 0;
      const adbReadable = new globalThis.ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
          } else if (pulls === 2) {
            controller.enqueue(new Uint8Array([4, 5, 6]));
          } else {
            controller.close();
          }
        },
      });

      const mockAdbSocket: AdbSocketLike = {
        service: 'test',
        readable: adbReadable,
        writable: new globalThis.WritableStream<Uint8Array>(),
        close: async () => {},
      };

      bridgeNetAndAdbSocket(mockNetSocket, mockAdbSocket);

      // Give microtasks time to process the first chunk
      await new Promise((r) => setTimeout(r, 20));
      expect(writtenToNet).to.have.lengthOf(1);
      expect(Buffer.from(writtenToNet[0])).to.deep.equal(Buffer.from([1, 2, 3]));
      // Second chunk must NOT have been written yet because netSocket hasn't drained
      expect(pulls).to.be.at.most(2);
      expect(ended).to.equal(false);

      // Now signal drain and allow subsequent writes
      allowWrite = true;
      mockNetSocket.emit('drain');

      await new Promise((r) => setTimeout(r, 20));
      expect(writtenToNet).to.have.lengthOf(2);
      expect(Buffer.from(writtenToNet[1])).to.deep.equal(Buffer.from([4, 5, 6]));
      expect(ended).to.equal(true);
    });
  });
});
