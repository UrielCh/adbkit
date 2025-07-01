import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import IpRouteCommand from '../../../../src/adb/command/host-transport/ipRoute.js';
import Tester from './Tester.js';

const t = new Tester(IpRouteCommand);

describe('ipRouteCommand', () => {
    it("should send 'ip route'", () => t.testTr('shell:ip route'));

    it("should send 'su -c p iroute'", () => t.sudo().testTr('shell:ip route'));

    it("should send 'ip route list table all'", () => t.testTr('shell:ip route list table all', 'list table all'));

    it("should send 'ip route list table all' split", () => t.testTr('shell:ip route list table all', 'list', 'table', 'all'));

    it('should return a list of routes', async() => {
        const result = await t.testPr(
        `192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.2\n`);
        return expect(result).to.eql( [{ dest: '192.168.1.0/24', dev: 'wlan0', proto: 'kernel', scope: 'link', src: '192.168.1.2' }]);
    });

    it('should return convert number string to numbers', async () => {
        const result =  await t.testPr(`fe80::/64 dev wlan0 table 1021 proto kernel metric 256 pref medium\n`);
        return expect(result).to.eql( [{ dest: 'fe80::/64', dev: 'wlan0', table: 1021, proto: 'kernel', metric: 256, pref: 'medium' }]);
    });
});
