import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
import { ServiceCallCommand, ParcelReader } from '../../../../src/index.js';
use(simonChai);
import Tester from './Tester.js';
const t = new Tester(ServiceCallCommand);

describe('serviceCall', () => {
    // it("should send ''", () => t.testTr('shell:ps'));
    it('should parse single line Parcel', async () => {
        const result: ParcelReader = await t.testPr(`Result: Parcel(00000000 00000002 00340032 00000000 '........2.4.....')`);
        expect(result.readType()).to.eql(0);
        expect(result.readString()).to.eql('24');
        return true;
    });

    it('should parse multi lines Parcel', async () => {
        const result: ParcelReader = await t.testPr(`Result: Parcel(
            0x00000000: 00000000 0000000f 00360038 00390037 '........1.3.7.9.'
            0x00000010: 00380035 00350030 00330031 00370031 '5.8.0.5.8.6.1.7.'
            0x00000020: 00330035 00000036                   '5.3.6...        ')`) ;
        expect(result.readType()).to.eql(0);
        expect(result.readString()).to.eql('867958051317536');
    });

    it('should read multiple consecutive strings without corrupting pos', () => {
        // Two VAL_STRING (type 0) entries: "ab" (len 2, 1 block) and "cd" (len 2, 1 block)
        const buf = Buffer.alloc(24);
        let offset = 0;
        // string 1: type=0, chars=2, 'b' (0x0062) then 'a' (0x0061) in big-endian 32-bit word
        buf.writeInt32BE(0, offset); offset += 4;
        buf.writeInt32BE(2, offset); offset += 4;
        buf.writeUInt16BE(0x0062, offset); offset += 2;
        buf.writeUInt16BE(0x0061, offset); offset += 2;
        // string 2: type=0, chars=2, 'd' (0x0064) then 'c' (0x0063) in big-endian 32-bit word
        buf.writeInt32BE(0, offset); offset += 4;
        buf.writeInt32BE(2, offset); offset += 4;
        buf.writeUInt16BE(0x0064, offset); offset += 2;
        buf.writeUInt16BE(0x0063, offset);

        const reader = new ParcelReader(buf);
        expect(reader.read()).to.eql('ab');
        expect(reader.read()).to.eql('cd');
    });
});
