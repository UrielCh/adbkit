import { expect } from 'chai';

import Adb, { Client, KeyCodesMap, PushTransfer, Pushtransfer, Utils } from '../src/index.js';

describe('Adb', () => {
    it('should expose KeyCodesMap', () => {
        expect(KeyCodesMap).to.be.an('object');
    });

    it('should expose util', () => {
        expect(Adb).to.have.property('util', Utils);
    });

    it('should export PushTransfer and keep Pushtransfer as alias', () => {
        expect(PushTransfer).to.equal(Pushtransfer);
    });

    describe('@createClient(options)', () => {
        it('should return a Client instance', () => {
            expect(Adb.createClient()).to.be.an.instanceOf(Client);
        });
    });
});
