import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import GetPackagesCommand from '../../../../src/adb/command/host-transport/getpackages.js';
import Tester from './Tester.js';
const t = new Tester(GetPackagesCommand);

describe('GetPackagesCommand', () => {
    it("should send 'pm list packages'", () => t.testTr('shell:pm list packages 2>/dev/null'));
    it("should send 'pm list packages' with flag", () => t.testTr('shell:pm list packages -3 2>/dev/null', '-3'));
    it("should send 'pm list packages' with multiple flags and variadic flags", async () => {
        await t.testTr('shell:pm list packages -3 -d 2>/dev/null', '-3 -d');
        await t.testTr('shell:pm list packages -3 --user 0 2>/dev/null', '-3', '--user', '0');
    });
    it('should escape unsafe characters in flags', async () => {
        await t.testTr("shell:pm list packages '-3;' rm -rf / 2>/dev/null", '-3; rm -rf /');
        await t.testTr("shell:pm list packages '$(id)' 2>/dev/null", '$(id)');
        await t.testTr("shell:pm list packages -3 'foo'\"'\"'bar' 2>/dev/null", '-3', "foo'bar");
        await t.testTr("shell:pm list packages -3 'foo bar' 2>/dev/null", '-3', 'foo bar');
    });

    it('should return an empty array for an empty package list', async () => {
        const packages = await t.testTr('');
        return expect(packages).to.be.empty;
    });

    it('should return an array of packages including hyphenated identifiers', async () => {
        const packages = await t.testPr(`package:com.google.android.gm
package:com.google.android.inputmethod.japanese
package:com.google.android.tag\r
package:com.google.android.GoogleCamera
package:com.google.android.youtube
package:com.google.android.apps.magazines
package:com.google.earth
package:com.example.my-app`);
        expect(packages).to.have.length(8);
        return expect(packages).to.eql([
            'com.google.android.gm',
            'com.google.android.inputmethod.japanese',
            'com.google.android.tag',
            'com.google.android.GoogleCamera',
            'com.google.android.youtube',
            'com.google.android.apps.magazines',
            'com.google.earth',
            'com.example.my-app',
        ]);
    })
});
