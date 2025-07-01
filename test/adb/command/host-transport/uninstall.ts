import { setImmediate } from "node:timers";
import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import { AdbPrematureEOFError } from '../../../../src/index.js';
import UninstallCommand from '../../../../src/adb/command/host-transport/uninstall.js';

describe('UninstallCommand', () => {
    it("should succeed when command responds with 'Success'", () => {
        const conn = new MockConnection();
        const cmd = new UninstallCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('shell:pm uninstall foo').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\r\n');
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('foo');
    });
    it("should succeed even if command responds with 'Failure'", () => {
        const conn = new MockConnection();
        const cmd = new UninstallCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('shell:pm uninstall foo').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Failure\r\n');
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('foo');
    });
    // https://github.com/DeviceFarmer/adbkit/pull/513
    it("should failed if command responds with 'Failure [DELETE_FAILED_DEVICE_POLICY_MANAGER]'", function (done) {
        const conn = new MockConnection();
        const cmd = new UninstallCommand(conn);
        conn.getSocket().on('write', function (chunk) {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('shell:pm uninstall foo').toString());
        });
        setImmediate(function () {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Failure [DELETE_FAILED_DEVICE_POLICY_MANAGER]\r\n');
            return conn.getSocket().causeEnd();
        });
        cmd.execute('foo').catch(function (err) {
            expect(err.message).includes('Failure [DELETE_FAILED_DEVICE_POLICY_MANAGER]');
            done();
        });
    });
    it("should succeed even if command responds with 'Failure' with info in standard format", () => {
        const conn = new MockConnection();
        const cmd = new UninstallCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('shell:pm uninstall foo').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Failure [DELETE_FAILED_INTERNAL_ERROR]\r\n');
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('foo');
    });
    it("should succeed even if command responds with 'Failure' with info info in weird format", () => {
        const conn = new MockConnection();
        const cmd = new UninstallCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Failure - not installed for 0\r\n');
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('foo');
    });
    it('should succeed even if command responds with a buggy exception', () => {
        const conn = new MockConnection();
        const cmd = new UninstallCommand(conn);
        setImmediate(() => {
            const socket = conn.getSocket();
            socket.causeRead(Protocol.OKAY);
            socket.causeRead(`
Exception occurred while dumping:
java.lang.IllegalArgumentException: Unknown package: foo
	at com.android.server.pm.Settings.isOrphaned(Settings.java:4134)
	at com.android.server.pm.PackageManagerService.isOrphaned(PackageManagerService.java:18066)
	at com.android.server.pm.PackageManagerService.deletePackage(PackageManagerService.java:15483)
	at com.android.server.pm.PackageInstallerService.uninstall(PackageInstallerService.java:888)
	at com.android.server.pm.PackageManagerShellCommand.runUninstall(PackageManagerShellCommand.java:765)
	at com.android.server.pm.PackageManagerShellCommand.onCommand(PackageManagerShellCommand.java:113)
	at android.os.ShellCommand.exec(ShellCommand.java:94)
	at com.android.server.pm.PackageManagerService.onShellCommand(PackageManagerService.java:18324)
	at android.os.Binder.shellCommand(Binder.java:468)
	at android.os.Binder.onTransact(Binder.java:367)
	at android.content.pm.IPackageManager$Stub.onTransact(IPackageManager.java:2387)
	at com.android.server.pm.PackageManagerService.onTransact(PackageManagerService.java:3019)
	at android.os.Binder.execTransact(Binder.java:565)`);
            socket.causeEnd();
        });
        return cmd.execute('foo');
    });
    it('should reject with AdbPrematureEOFError if stream ends before match', (done) => {
        const conn = new MockConnection();
        const cmd = new UninstallCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Hello. Is it me you are looking for?\r\n');
            return conn.getSocket().causeEnd();
        });
        cmd.execute('foo').catch(err => {
            if (err instanceof AdbPrematureEOFError) {
                done();
            } else {
                // failed
            }
        });
    });
    it('should ignore any other data', () => {
        const conn = new MockConnection();
        const cmd = new UninstallCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('shell:pm uninstall foo').toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('open: Permission failed\r\n');
            conn.getSocket().causeRead('Failure\r\n');
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('foo');
    });
});
