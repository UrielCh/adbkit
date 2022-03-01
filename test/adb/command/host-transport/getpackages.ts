import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection';
import Protocol from '../../../../src/adb/protocol';
import GetPackagesCommand from '../../../../src/adb/command/host-transport/getpackages';

describe('GetPackagesCommand', function () {
    it("should send 'pm list packages'", function () {
        const conn = new MockConnection();
        const cmd = new GetPackagesCommand(conn);
        conn.getSocket().on('write', (chunk: Buffer) => {
            return expect(chunk.toString()).to.equal(
                Protocol.encodeData('shell:pm list packages 2>/dev/null').toString(),
            );
        });
        setImmediate(function () {
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        return cmd.execute();
    });
    it("should send 'pm list packages' with flag", function () {
        const conn = new MockConnection();
        const cmd = new GetPackagesCommand(conn);
        conn.getSocket().on('write', function (chunk) {
            return expect(chunk.toString()).to.equal(Protocol.encodeData('shell:pm list packages -3 2>/dev/null').toString());
        });
        setImmediate(function () {
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        return cmd.execute('-3');
    });

    it('should return an empty array for an empty package list', async () => {
        const conn = new MockConnection();
        const cmd = new GetPackagesCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        const packages = await cmd.execute()
        expect(packages).to.be.empty;
        return true;
    });
    return it('should return an array of packages', async () => {
        const conn = new MockConnection();
        const cmd = new GetPackagesCommand(conn);
        setImmediate(() => {
            const socket = conn.getSocket();
            socket.causeRead(Protocol.OKAY);
            socket.causeRead(`package:com.google.android.gm
package:com.google.android.inputmethod.japanese
package:com.google.android.tag\r
package:com.google.android.GoogleCamera
package:com.google.android.youtube
package:com.google.android.apps.magazines
package:com.google.earth`);
            return socket.causeEnd();
        });
        const packages = await cmd.execute()
        expect(packages).to.have.length(7);
        expect(packages).to.eql([
            'com.google.android.gm',
            'com.google.android.inputmethod.japanese',
            'com.google.android.tag',
            'com.google.android.GoogleCamera',
            'com.google.android.youtube',
            'com.google.android.apps.magazines',
            'com.google.earth',
        ]);
        return true;
    });
});
