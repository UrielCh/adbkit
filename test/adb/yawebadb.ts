import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import { Buffer } from 'node:buffer';
import Net from 'node:net';
import Adb, {
  Client,
  isYaWebAdbAvailable,
  setYaWebAdbLoader,
  YaWebAdbManager,
  YaWebAdbModules,
  YaWebAdbSocket,
} from '../../src/index.js';
import type { AdbTransportLike, WebUsbDeviceLike } from '../../src/adb/yawebadb/types.js';

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
});
