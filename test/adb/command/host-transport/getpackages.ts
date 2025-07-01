import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import GetPackagesCommand from '../../../../src/adb/command/host-transport/getpackages.js';
import Tester from './Tester.js';
const t = new Tester(GetPackagesCommand);

describe('GetPackagesCommand', () => {
    it("should send 'pm list packages'", () => t.testTr('shell:pm list packages 2>/dev/null'));
    it("should send 'pm list packages' with flag", () => t.testTr('shell:pm list packages -3 2>/dev/null', '-3'));

    it('should return an empty array for an empty package list', async () => {
        const packages = await t.testTr('');
        return expect(packages).to.be.empty;
    });

    it('should return an array of packages', async () => {
        const packages = await t.testPr(`package:com.google.android.gm
package:com.google.android.inputmethod.japanese
package:com.google.android.tag\r
package:com.google.android.GoogleCamera
package:com.google.android.youtube
package:com.google.android.apps.magazines
package:com.google.earth`);
        expect(packages).to.have.length(7);
        return expect(packages).to.eql([
            'com.google.android.gm',
            'com.google.android.inputmethod.japanese',
            'com.google.android.tag',
            'com.google.android.GoogleCamera',
            'com.google.android.youtube',
            'com.google.android.apps.magazines',
            'com.google.earth',
        ]);
    })
});
