import { expect } from 'chai';
import Net from 'node:net';
import { Duplex } from 'node:stream';
import { Buffer } from 'node:buffer';
import Sinon from 'sinon';
import Adb, { setYaWebAdbLoader, YaWebAdbManager, YaWebAdbSocket } from '../../src/index.js';
import Connection from '../../src/adb/connection.js';
import Utils from '../../src/adb/utils.js';

describe('Client & Connection reliability', () => {
  afterEach(() => {
    Sinon.restore();
    setYaWebAdbLoader(null);
    YaWebAdbManager.resetInstance();
  });

  describe('Client.connection() error propagation', () => {
    it('should not throw an uncaught error event crash when client has no error listener', async () => {
      const server = Net.createServer((socket) => {
        socket.on('error', () => {});
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as Net.AddressInfo).port;

      try {
        const client = Adb.createClient({ host: '127.0.0.1', port, useYaWebAdb: false });
        const conn = await client.connection();
        // Simulate an unhandled socket error when no Parser/write listener is attached
        const testErr = new Error('simulated idle socket failure');
        conn.getSocket() && (conn.getSocket() as Net.Socket).emit('error', testErr);
        // Should reach here without Node throwing an unhandled 'error' event
        conn.end();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('should forward connection errors to client when an error listener is attached', async () => {
      const server = Net.createServer((socket) => {
        socket.on('error', () => {});
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as Net.AddressInfo).port;

      try {
        const client = Adb.createClient({ host: '127.0.0.1', port, useYaWebAdb: false });
        const received: Error[] = [];
        client.on('error', (err) => received.push(err));
        const conn = await client.connection();
        const testErr = new Error('forwarded socket error');
        (conn.getSocket() as Net.Socket).emit('error', testErr);
        expect(received).to.deep.equal([testErr]);
        conn.end();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('Connection.connect() ya-webadb host check & ECONNREFUSED cleanup', () => {
    it('should not use YaWebAdbSocket when host points to a remote server and useYaWebAdb is omitted', async () => {
      setYaWebAdbLoader(async () => ({}) as never);
      const client = Adb.createClient({ host: '192.0.2.1', port: 5037 });
      const conn = new Connection(client);
      // Prevent spawning local adb binary on connection failure
      conn.startServer = async () => {
        throw new Error('no local server for remote');
      };
      // Trigger immediate ECONNREFUSED on the TCP socket created by connect()
      const origConnect = conn.connect.bind(conn);
      // Wait for socket to fail naturally or emit ECONNREFUSED quickly
      const connectPromise = origConnect();
      // Grab the underlying socket once created on next microtask after isYaWebAdbAvailable
      await Utils.delay(5);
      const sock = conn.getSocket() as Net.Socket;
      expect(sock).to.not.be.instanceOf(YaWebAdbSocket);
      expect(sock).to.be.instanceOf(Net.Socket);
      sock.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

      let caught: unknown;
      try {
        await connectPromise;
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.an.instanceOf(Error);
    });

    it('should end and clean up the failed first socket on ECONNREFUSED retry', async () => {
      // Reserve an unused port
      const server = Net.createServer();
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as Net.AddressInfo).port;
      await new Promise<void>((resolve) => server.close(() => resolve()));

      const client = Adb.createClient({ host: '127.0.0.1', port, useYaWebAdb: false });
      const conn = new Connection(client);
      const closeEvents: boolean[] = [];
      conn.on('close', (hadError) => closeEvents.push(hadError));

      const endSpy = Sinon.spy(Net.Socket.prototype, 'end');
      const destroySpy = Sinon.spy(Net.Socket.prototype, 'destroy');
      let firstSocket: Net.Socket | undefined;
      let retryServer: Net.Server | undefined;

      conn.startServer = async () => {
        firstSocket = conn.getSocket() as Net.Socket;
        expect(firstSocket.destroyed).to.equal(true);
        expect(endSpy.calledOn(firstSocket)).to.equal(true);
        expect(destroySpy.calledOn(firstSocket)).to.equal(true);
        // Now start listening on the port so the retry succeeds
        retryServer = Net.createServer((s) => {
          s.on('error', () => {});
        });
        await new Promise<void>((resolve) => retryServer!.listen(port, '127.0.0.1', resolve));
        return { stdout: '', stderr: '' };
      };

      try {
        await conn.connect();
        await Utils.delay(20);
        const secondSocket = conn.getSocket() as Net.Socket;
        expect(firstSocket).to.exist;
        expect(secondSocket).to.not.equal(firstSocket);
        // No stale 'close' event should have leaked from the failed first socket onto conn
        expect(closeEvents).to.deep.equal([]);
        conn.end();
      } finally {
        if (retryServer) {
          await new Promise<void>((resolve) => retryServer!.close(() => resolve()));
        }
      }
    });
  });

  describe('Connection.write()', () => {
    it('should reject with explicit error when called before connect()', async () => {
      const client = Adb.createClient({ useYaWebAdb: false });
      const conn = new Connection(client);

      let caught: unknown;
      try {
        await conn.write(Buffer.from('hello'));
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.an.instanceOf(Error);
      expect(caught).to.not.be.an.instanceOf(TypeError);
      expect((caught as Error).message).to.equal('Socket is not connected');
    });

    it('should reject if the socket closes before draining after write returns false', async () => {
      const client = Adb.createClient({ useYaWebAdb: false });
      const conn = new Connection(client);
      const mockSocket = new Duplex({
        highWaterMark: 4,
        write(_chunk, _encoding, _callback) {
          // Never invoke callback so write() returns false and waits for drain
        },
        read() {},
      });
      conn.socket = mockSocket as unknown as Net.Socket;

      const writePromise = conn.write(Buffer.from('12345678'));
      await Utils.delay(10);
      mockSocket.destroy();

      let caught: unknown;
      try {
        await writePromise;
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.an.instanceOf(Error);
    });

    it('should resolve with byte count when socket drains after write returns false', async () => {
      const client = Adb.createClient({ useYaWebAdb: false });
      const conn = new Connection(client);
      let releaseWrite!: () => void;
      const mockSocket = new Duplex({
        highWaterMark: 4,
        write(_chunk, _encoding, callback) {
          releaseWrite = () => callback();
        },
        read() {},
      });
      conn.socket = mockSocket as unknown as Net.Socket;

      const payload = Buffer.from('12345678');
      const writePromise = conn.write(payload);
      await Utils.delay(10);
      releaseWrite();

      const written = await writePromise;
      expect(written).to.equal(8);
    });
  });
});
