import test from 'node:test';
import assert from 'node:assert';

import Adb, { Utils } from '../src/index.js';

test('Adb', (t) => {
    // t.test('should expose Keycode', () => {
    //     assert.ok(Adb.hasOwnProperty('Keycode'));
    //     assert.strictEqual(Adb.Keycode, Keycode);
    // });

    t.test('should expose util', (t, done) => {
        assert.ok(Adb.hasOwnProperty('util'));
        assert.strictEqual(Adb.util, Utils);
        console.log('done', done);
    });

    // t.test('@createClient(options)', (t) => {
    //     t.test('should return a Client instance', () => {
    //         assert.ok(Adb.createClient() instanceof Client);
    //     });
    // });
});