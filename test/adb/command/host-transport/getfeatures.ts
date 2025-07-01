import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import GetFeaturesCommand from '../../../../src/adb/command/host-transport/getfeatures.js';

describe('GetFeaturesCommand', () => {
    it("should send 'pm list features'", () => {
        const conn = new MockConnection();
        const cmd = new GetFeaturesCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(
                Protocol.encodeData('shell:pm list features 2>/dev/null').toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            return conn.getSocket().causeEnd();
        });
        return cmd.execute();
    });
    it('should return an empty object for an empty feature list', async () => {
        const conn = new MockConnection();
        const cmd = new GetFeaturesCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeEnd();
        });
        const features = await cmd.execute();
        expect(Object.keys(features)).to.be.empty;
        return true;
    });
    it('should return a map of features', async () => {
        const conn = new MockConnection();
        const cmd = new GetFeaturesCommand(conn);
        setImmediate(() => {
            const socket = conn.getSocket();
            socket.causeRead(Protocol.OKAY);
            socket.causeRead(`feature:reqGlEsVersion=0x20000
feature:foo\r
feature:bar`);
            socket.causeEnd();
        });
        const features = await cmd.execute();
        expect(Object.keys(features)).to.have.length(3);
        expect(features).to.eql({
            reqGlEsVersion: '0x20000',
            foo: true,
            bar: true,
        });
        return true;
    });
});
