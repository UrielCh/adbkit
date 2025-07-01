import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
Chai.use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import ClearCommand from '../../../../src/adb/command/host-transport/clear.js';
import Tester from './Tester.js';
const t = new Tester(ClearCommand);

describe('ClearCommand', () => {
    it("should send 'pm clear <pkg>'", () => {
        const conn = new MockConnection();
        const cmd = new ClearCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData('shell:pm clear foo.bar.c').toString());
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\r\n');
            conn.getSocket().causeEnd();
        });
        return cmd.execute('foo.bar.c');
    });
    it("should succeed on 'Success'", () => {
        const conn = new MockConnection();
        const cmd = new ClearCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\r\n');
            conn.getSocket().causeEnd();
        });
        return cmd.execute('foo.bar.c');
    });
    it("should error on 'Failed'", (done) => {
        const conn = new MockConnection();
        const cmd = new ClearCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Failed\r\n');
            conn.getSocket().causeEnd();
        });
        cmd.execute('foo.bar.c').catch((err) => {
            expect(err).to.be.an.instanceof(Error);
            done();
        });
    });
    it("should error on 'Failed' even if connection not closed by device", (done) => {
        const conn = new MockConnection();
        const cmd = new ClearCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Failed\r\n');
        });
        cmd.execute('foo.bar.c').catch((err) => {
            expect(err).to.be.an.instanceof(Error);
            done();
        });
    });
    it('should ignore irrelevant lines', async () => {
        const result = await t.testPr(['Open: foo error\n\n', 'Success\r\n'], 'foo.bar.c')
        return expect(result).to.be.eq(true);
    });
});
