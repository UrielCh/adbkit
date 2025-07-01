import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import PsCommand from '../../../../src/adb/command/host-transport/ps.js';
import Tester from './Tester.js';
const t = new Tester(PsCommand);

describe('psCommand', () => {
    it("should send 'ps'", () => t.testTr('shell:ps'));

    it("should send 'ps -f'", () => t.testTr('shell:ps -f', '-f'));

    it('should return a list of PsEntry', async () => {
        const result = await t.testPr(`UID             PID   PPID C STIME TTY          TIME CMD
shell         30941   3021 0 15:35:50 pts/3 00:00:00 sh
shell         31350  30941 21 16:18:23 pts/3 00:00:00 ps -f
`);
        return expect(result).to.eql([
            { UID: 'shell', PID: '30941', PPID: '3021', C: '0', STIME: '15:35:50', TTY: 'pts/3', TIME: '00:00:00', CMD: 'sh' },
            { UID: 'shell', PID: '31350', PPID: '30941', C: '21', STIME: '16:18:23', TTY: 'pts/3', TIME: '00:00:00', CMD: 'ps -f' },
        ]);
    });

    it('should return a list of PsEntry -A', async () => {
        const result = await t.testPr(`USER            PID   PPID     VSZ    RSS WCHAN            ADDR S NAME
root              1      0 10826728  3728 0                   0 S init
root              2      0       0      0 0                   0 S [kthreadd]`);
        return expect(result).to.eql([
            { USER: 'root', PID: '1', PPID: '0', VSZ: '10826728', RSS: '3728', WCHAN: '0', ADDR: '0', S: 'S', NAME: 'init' },
            { USER: 'root', PID: '2', PPID: '0', VSZ: '0', RSS: '0', WCHAN: '0', ADDR: '0', S: 'S', NAME: '[kthreadd]' },
        ])
    });
});
