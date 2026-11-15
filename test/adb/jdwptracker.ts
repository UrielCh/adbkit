import { expect } from 'chai';
import { once } from 'node:events';
import JdwpTracker from '../../src/adb/jdwptracker.js';
import TrackJdwpCommand from '../../src/adb/command/host-transport/trackjdwp.js';
import MockConnection from '../mock/connection.js';
import Protocol from '../../src/adb/protocol.js';

describe('JdwpTracker', () => {
  it('reads consecutive JDWP updates and stops cleanly', async () => {
    const conn = new MockConnection();
    const tracker = new JdwpTracker(new TrackJdwpCommand(conn));
    const changes: unknown[] = [];
    tracker.on('changeSet', (change) => changes.push(change));
    conn.getSocket().causeRead(Protocol.encodeData('1\n2\n'));
    await new Promise(resolve => setImmediate(resolve));
    conn.getSocket().causeRead(Protocol.encodeData('2\n3\n'));
    await new Promise(resolve => setImmediate(resolve));
    expect(changes).to.deep.equal([{ added: ['1', '2'], removed: [] }, { added: ['3'], removed: ['1'] }]);
    const ended = once(tracker, 'end');
    tracker.end();
    await ended;
  });

});
