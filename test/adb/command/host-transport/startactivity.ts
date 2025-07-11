import { setImmediate } from "node:timers";
import { expect, use } from 'chai';
import simonChai from 'sinon-chai';
use(simonChai);
import MockConnection from '../../../mock/connection.js';
import Protocol from '../../../../src/adb/protocol.js';
import StartActivityCommand from '../../../../src/adb/command/host-transport/startactivity.js';
import { StartActivityOptions } from '../../../../src/index.js';

describe('StartActivityCommand', () => {
    it("should succeed when 'Success' returned", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        setImmediate(() => {
            const socket = conn.getSocket();
            socket.causeRead(Protocol.OKAY);
            socket.causeRead('Success');
            socket.causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
        };
        return cmd.execute(options);
    });
    it("should fail when 'Error' returned", (done) => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Error: foo\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
        };
        cmd.execute(options).catch((err) => {
            expect(err).to.be.be.an.instanceOf(Error);
            done();
        });
    });
    it("should send 'am start -n <pkg>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData("shell:am start -n 'com.dummy.component/.Main'").toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            return conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
        };
        return cmd.execute(options);
    });
    it("should send 'am start -W -D --user 0 -n <pkg>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData("shell:am start -n 'com.dummy.component/.Main' -D -W --user 0").toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            return conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
            user: 0,
            wait: true,
            debug: true,
        };
        return cmd.execute(options);
    });
    it("should send 'am start -a <action>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData("shell:am start -a 'foo.ACTION_BAR'").toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            action: 'foo.ACTION_BAR',
        };
        return cmd.execute(options);
    });
    it("should send 'am start -d <data>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData("shell:am start -d 'foo://bar'").toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            data: 'foo://bar',
        };
        return cmd.execute(options);
    });
    it("should send 'am start -t <mimeType>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData("shell:am start -t 'text/plain'").toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            mimeType: 'text/plain',
        };
        return cmd.execute(options);
    });
    it("should send 'am start -c <category>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(
                Protocol.encodeData("shell:am start -c 'android.intent.category.LAUNCHER'").toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            category: 'android.intent.category.LAUNCHER',
        };
        return cmd.execute(options);
    });
    it("should send 'am start -c <category1> -c <category2>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(
                Protocol.encodeData(
                    "shell:am start -c 'android.intent.category.LAUNCHER' -c 'android.intent.category.DEFAULT'",
                ).toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            category: ['android.intent.category.LAUNCHER', 'android.intent.category.DEFAULT'],
        };
        return cmd.execute(options);
    });
    it("should send 'am start -f <flags>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData(`shell:am start -f ${0x10210000}`).toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            flags: 0x10210000,
        };
        return cmd.execute(options);
    });
    it("should send 'am start -n <pgk> --es <extras>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData("shell:am start --es 'key1' 'value1' --es 'key2' 'value2' -n 'com.dummy.component/.Main'").toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            return conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
            extras: [
                { key: 'key1', value: 'value1'},
                { key: 'key2', value: 'value2'},
            ],
        } as StartActivityOptions;
        return cmd.execute(options);
    });
    it("should send 'am start -n <pgk> --ei <extras>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData("shell:am start --ei 'key1' 1 --ei 'key2' 2 -n 'com.dummy.component/.Main'").toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success\n');
            conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
            extras: [
                { key: 'key1', value: 1, type: 'int' as const },
                { key: 'key2', value: 2, type: 'int' as const },
            ],
        };
        return cmd.execute(options);
    });
    it("should send 'am start -n <pgk> --ez <extras>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(Protocol.encodeData("shell:am start --ez 'key1' 'true' --ez 'key2' 'false' -n 'com.dummy.component/.Main'").toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success');
            return conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
            extras: [
                { key: 'key1', value: true, type: 'bool' as const },
                { key: 'key2', value: false, type: 'bool' as const },
            ],
        };
        return cmd.execute(options);
    });
    it("should send 'am start -n <pgk> --el <extras>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(
                Protocol.encodeData(
                    "shell:am start --el 'key1' 1 --el 'key2' '2' -n 'com.dummy.component/.Main'",
                ).toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success');
            conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
            extras: [
                { key: 'key1', value: 1, type: 'long' as const },
                { key: 'key2', value: '2', type: 'long' as const },
            ],
        };
        return cmd.execute(options);
    });
    it("should send 'am start -n <pgk> --eu <extras>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            return expect(chunk.toString()).to.equal(
                Protocol.encodeData(
                    "shell:am start --eu 'key1' 'http://example.org' --eu 'key2' 'http://example.org' -n 'com.dummy.component/.Main'",
                ).toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success');
            return conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
            extras: [
                { key: 'key1', value: 'http://example.org', type: 'uri' as const },
                { key: 'key2', value: 'http://example.org', type: 'uri' as const },
            ],
        };
        return cmd.execute(options);
    });
    it("should send 'am start -n <pgk> --es <extras>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData("shell:am start --es 'key1' 'a' --es 'key2' 'b' -n 'com.dummy.component/.Main'").toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success');
            conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
            extras: [
                { key: 'key1', value: 'a', type: 'string' as const },
                { key: 'key2', value: 'b', type: 'string' as const },
            ],
        };
        return cmd.execute(options);
    });
    it("should send 'am start -n <pgk> --eia <extras with arr>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(Protocol.encodeData("shell:am start --eia 'key1' '2,3' --ela 'key2' '20,30' --ei 'key3' 5 -n 'com.dummy.component/.Main'").toString());
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success');
            conn.getSocket().causeEnd();
        });
        const options: StartActivityOptions = {
            component: 'com.dummy.component/.Main',
            extras: [
                { key: 'key1', value: [2, 3], type: 'int' },
                { key: 'key2', value: [20, 30], type: 'long' },
                { key: 'key3', value: 5, type: 'int' },
            ],
        };
        return cmd.execute(options);
    });
    it("should send 'am start -n <pgk> --esn <extras>'", () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(
                Protocol.encodeData("shell:am start --esn 'key1' --esn 'key2' -n 'com.dummy.component/.Main'").toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success');
            conn.getSocket().causeEnd();
        });
        const options: StartActivityOptions = {
            component: 'com.dummy.component/.Main',
            extras: [
                { key: 'key1', type: 'null' },
                { key: 'key2', type: 'null' },
            ],
        };
        return cmd.execute(options);
    });
    it('should throw when calling with an unknown extra type', (done) => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        const options = {
            component: 'com.dummy.component/.Main',
            extras: [
                {
                    key: 'key1',
                    value: 'value1',
                    type: 'nonexisting',
                },
            ],
        } as unknown;
        expect(() => {
            cmd.execute(options as StartActivityOptions);
        }).to.throw;
        done();
    });
    it('should accept mixed types of extras', () => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        conn.getSocket().on('write', (chunk) => {
            expect(chunk.toString()).to.equal(
                Protocol.encodeData(
                    "shell:am start --ez 'key1' 'true' --es 'key2' 'somestr' --es 'key3' 'defaultType' --ei 'key4' 3 --el 'key5' '4' --eu 'key6' 'http://example.org' --esn 'key7' -n 'com.dummy.component/.Main'",
                ).toString(),
            );
        });
        setImmediate(() => {
            conn.getSocket().causeRead(Protocol.OKAY);
            conn.getSocket().causeRead('Success');
            conn.getSocket().causeEnd();
        });
        const options = {
            component: 'com.dummy.component/.Main',
            extras: [
                { key: 'key1', value: true, type: 'bool' },
                { key: 'key2', value: 'somestr', type: 'string'},
                { key: 'key3', value: 'defaultType' },
                { key: 'key4', value: 3, type: 'int' },
                { key: 'key5', value: '4', type: 'long' },
                { key: 'key6', value: 'http://example.org', type: 'uri' },
                { key: 'key7', type: 'null' },
            ],
        } as StartActivityOptions;
        return cmd.execute(options);
    });
    it('should map short extras to long extras', (done) => {
        const conn = new MockConnection();
        const cmd = new StartActivityCommand(conn);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const short = (cmd as any)._formatExtras({
            someString: 'bar',
            someInt: 5,
            someUrl: {
                type: 'uri',
                value: 'http://example.org',
            },
            someArray: {
                type: 'int',
                value: [1, 2],
            },
            someNull: null,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const long = (cmd as any)._formatExtras([
            { key: 'someString', value: 'bar', type: 'string' },
            { key: 'someInt', value: 5, type: 'int' },
            { key: 'someUrl', value: 'http://example.org', type: 'uri' },
            { key: 'someArray', value: [1, 2], type: 'int' },
            { key: 'someNull', type: 'null' },
        ]);
        expect(short).to.eql(long);
        done();
    });
});
