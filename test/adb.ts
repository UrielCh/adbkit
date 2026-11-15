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
        it('resolves the port from options, environment, or default', () => {
            const previous = process.env.ADB_PORT;
            try {
                process.env.ADB_PORT = '6123';
                expect(Adb.createClient().port).to.equal(6123);
                expect(Adb.createClient({ port: 7000 }).port).to.equal(7000);
                process.env.ADB_PORT = 'invalid';
                expect(Adb.createClient().port).to.equal(5037);
                delete process.env.ADB_PORT;
                expect(Adb.createClient().port).to.equal(5037);
            } finally {
                if (previous === undefined) delete process.env.ADB_PORT;
                else process.env.ADB_PORT = previous;
            }
        });

        it('should return a Client instance', () => {
            expect(Adb.createClient()).to.be.an.instanceOf(Client);
        });
    });
});
