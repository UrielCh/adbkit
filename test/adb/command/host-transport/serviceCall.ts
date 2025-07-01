import Chai, { expect } from 'chai';
import simonChai from 'sinon-chai';
import { ServiceCallCommand, ParcelReader } from '../../../../src/.js';
Chai.use(simonChai);
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
});
