import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import GetPropertiesCommand from '../../../../src/adb/command/host-transport/getproperties.js';
import Tester from './Tester.js';
const t = new Tester(GetPropertiesCommand);

describe('GetPropertiesCommand', () => {
    it("should send 'getprop'", () => t.testTr('shell:getprop'));
    it('should return an empty object for an empty property list', async () => {
        const properties = await t.testPr();
        expect(Object.keys(properties)).to.be.empty;
    });
    it('should return a map of properties', async () => {
        const properties = await t.testPr(`[ro.product.locale.region]: [US]
[ro.product.manufacturer]: [samsung]\r
[ro.product.model]: [SC-04E]
[ro.product.name]: [SC-04E]`);
        expect(Object.keys(properties)).to.have.length(4);
        expect(properties).to.eql({
            'ro.product.locale.region': 'US',
            'ro.product.manufacturer': 'samsung',
            'ro.product.model': 'SC-04E',
            'ro.product.name': 'SC-04E',
        });
    });
});
