import { expect } from 'chai';

import Adb, { Client, KeyCodesMap, Utils } from '../src/index.js';

describe('Adb', () => {
    it('should expose KeyCodesMap', () => {
        expect(KeyCodesMap).to.be.an('object');
    });

    it('should expose util', () => {
        expect(Adb).to.have.property('util', Utils);
    });

    describe('@createClient(options)', () => {
        it('should return a Client instance', () => {
            expect(Adb.createClient()).to.be.an.instanceOf(Client);
        });
    });
});
