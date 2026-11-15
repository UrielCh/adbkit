import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
import { ServiceCallCommand, ParcelReader } from '../../../../src/index.js';
use(simonChai);
import Tester from './Tester.js';
const t = new Tester(ServiceCallCommand);

describe('serviceCall', () => {
    it('quotes service, code and string arguments against shell expansion', async () => {
        const conn = new (await import('../../../mock/connection.js')).default();
        const cmd = new ServiceCallCommand(conn);
        let sent = '';
        conn.getSocket().on('write', chunk => { sent = chunk.toString().slice(4); });
        setImmediate(() => {
            conn.getSocket().causeRead('OKAY');
            conn.getSocket().causeRead("Result: Parcel(00000000 '....')");
            conn.getSocket().causeEnd();
        });
        await cmd.execute('svc;touch /tmp/x', '1$(id)', [{ type: 's16', value: "a'`$\\b" }]);
        expect(sent).to.equal("exec:service call 'svc;touch /tmp/x' '1$(id)' s16 'a'\"'\"'`$\\b' 2>/dev/null");
    });

    it('should parse single line Parcel', async () => {
        const result: ParcelReader = await t.testPr(`Result: Parcel(00000000 00000002 00340032 00000000 '........2.4.....')`, 'test', 1);
        expect(result.readType()).to.eql(0);
        expect(result.readString()).to.eql('24');
        return true;
    });

    it('should parse multi lines Parcel', async () => {
        const result: ParcelReader = await t.testPr(`Result: Parcel(
            0x00000000: 00000000 0000000f 00360038 00390037 '........1.3.7.9.'
            0x00000010: 00380035 00350030 00330031 00370031 '5.8.0.5.8.6.1.7.'
            0x00000020: 00330035 00000036                   '5.3.6...        ')`, 'test', 1) ;
        expect(result.readType()).to.eql(0);
        expect(result.readString()).to.eql('867958051317536');
    });

    it('should read multiple consecutive strings without corrupting pos', () => {
        // Parcel words are printed in big-endian order; each UTF-16 string
        // includes a terminator and padding to a four-byte boundary.
        const buf = Buffer.from('0000000000000002006200610000000000000000000000020064006300000000', 'hex');

        const reader = new ParcelReader(buf);
        expect(reader.read()).to.eql('ab');
        expect(reader.read()).to.eql('cd');
    });

    it('handles null and empty strings before another value', () => {
        const reader = new ParcelReader(Buffer.from('00000000ffffffff000000000000000000000000000000000000000100000078', 'hex'));
        expect(reader.read()).to.equal(null);
        expect(reader.read()).to.equal('');
        expect(reader.read()).to.equal('x');
    });

    it('rejects truncated strings and reads a null value type', () => {
        expect(new ParcelReader(Buffer.from('ffffffff', 'hex')).read()).to.equal(null);
        const reader = new ParcelReader(Buffer.from('0000000200620061', 'hex'));
        expect(() => reader.readString()).to.throw(RangeError, 'Truncated Parcel string');
    });

    it('parses short parcel lines', async () => {
        const result = await t.testPr("Result: Parcel(00000000 '....')", 'test', 1);
        expect(result.readType()).to.equal(0);
        const multiline = await t.testPr("Result: Parcel(\n0x00000000: 00000000 '....')", 'test', 1);
        expect(multiline.readType()).to.equal(0);
    });
});
