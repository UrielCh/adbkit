import { expect } from 'chai';
import { Readable } from 'node:stream';
import ProcStat from '../../../src/adb/proc/stat.js';
import type Sync from '../../../src/adb/sync.js';

describe('ProcStat', () => {
  it('calculates CPU load from successive snapshots and closes its sync', async () => {
    const snapshots = ['cpu0 10 0 10 80 0 0 0 0 0 0\n', 'cpu0 20 0 20 160 0 0 0 0 0 0\n'];
    let closed = false;
    const sync = {
      pull: async () => Readable.from([Buffer.from(snapshots.shift() ?? '')]),
      end: () => { closed = true; },
    } as unknown as Sync;
    const proc = new ProcStat(sync);
    try {
      // The constructor starts the first update immediately.
      await new Promise(resolve => setImmediate(resolve));
      const loads: unknown[] = [];
      proc.on('load', load => loads.push(load));
      const stats = await proc.update();
      expect(stats.cpus.cpu0.total).to.equal(200);
      expect(loads).to.deep.equal([{ cpu0: { user: 10, nice: 0, system: 10, idle: 80, iowait: 0, irq: 0, softirq: 0, steal: 0, guest: 0, guestnice: 0, total: 100 } }]);
    } finally {
      proc.end();
    }
    expect(closed).to.equal(true);
  });
});
