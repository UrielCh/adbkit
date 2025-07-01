import EventEmitter from 'node:events';
import Parser from '../parser.js';
import Sync from '../sync.js';
import { CpuStats, Loads } from '../../models/CpuStats.js';

const RE_CPULINE = /^cpu[0-9]+ .*$/gm;
const RE_COLSEP = / +/g;

export interface CpuStatsWithLine extends CpuStats {
  line: string;
}

export interface LoadsWithLine {
  [index: string]: CpuStatsWithLine;
}

export type ProcStats = { cpus: LoadsWithLine };

/**
 * enforce EventEmitter typing
 */
 interface IEmissions {
  load: (arg: Loads) => void
  error: (data: Error) => void
}

export default class ProcStat extends EventEmitter {
  public interval = 1000;
  public stats: ProcStats;
  private readonly _ignore: {[key: string]: string};
  private readonly _timer: ReturnType<typeof setInterval>;

  constructor(private sync?: Sync) {
    super();

    this.stats = this._emptyStats();
    this._ignore = {};
    this._timer = setInterval(() => {
      return this.update();
    }, this.interval);
    this.update();
  }

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  public end(): void {
    clearInterval(this._timer);
    if (this.sync) {
      this.sync.end();
      this.sync = undefined;
    }
  }

  public async update(): Promise<ProcStats> {
    if (!this.sync) {
      throw Error('Closed');
    }
    try {
      const transfert = await this.sync.pull('/proc/stat');
      const out = await new Parser(transfert).readAll();
      return this._parse(out.toString());
    } catch (err) {
      this._error(err as Error);
      return await Promise.reject(err);
    }
  }

  private _parse(out: string): ProcStats {
    let match: RegExpExecArray | null = null;
    let val: string;
    const stats = this._emptyStats();
    while ((match = RE_CPULINE.exec(out))) {
      const line: string = match[0];
      const cols = line.split(RE_COLSEP);
      const type = cols.shift();
      if (!type)
        continue;
      if (this._ignore[type] === line) {
        continue;
      }
      let total = 0;
      for (let i = 0, len = cols.length; i < len; i++) {
        val = cols[i];
        total += +val;
      }
      stats.cpus[type] = {
        line: line,
        user: +cols[0] || 0,
        nice: +cols[1] || 0,
        system: +cols[2] || 0,
        idle: +cols[3] || 0,
        iowait: +cols[4] || 0,
        irq: +cols[5] || 0,
        softirq: +cols[6] || 0,
        steal: +cols[7] || 0,
        guest: +cols[8] || 0,
        guestnice: +cols[9] || 0,
        total,
      };
    }
    return this._set(stats);
  }

  private _set(stats: ProcStats): ProcStats {
    const loads: Loads = {};
    let found = false;
    const ref = stats.cpus;
    for (const id in ref) {
      const cur = ref[id];
      const old = this.stats.cpus[id];
      if (!old) {
        continue;
      }
      const ticks = cur.total - old.total;
      if (ticks > 0) {
        found = true;
        // Calculate percentages for everything. For ease of formatting,
        // let's do `x / y * 100` as `100 / y * x`.
        const m = 100 / ticks;
        loads[id] = {
          user: Math.floor(m * (cur.user - old.user)),
          nice: Math.floor(m * (cur.nice - old.nice)),
          system: Math.floor(m * (cur.system - old.system)),
          idle: Math.floor(m * (cur.idle - old.idle)),
          iowait: Math.floor(m * (cur.iowait - old.iowait)),
          irq: Math.floor(m * (cur.irq - old.irq)),
          softirq: Math.floor(m * (cur.softirq - old.softirq)),
          steal: Math.floor(m * (cur.steal - old.steal)),
          guest: Math.floor(m * (cur.guest - old.guest)),
          guestnice: Math.floor(m * (cur.guestnice - old.guestnice)),
          total: 100,
        };
      } else {
        // The CPU is either offline (nothing was done) or it mysteriously
        // warped back in time (idle stat dropped significantly), causing the
        // total tick count to be <0. The latter seems to only happen on
        // Galaxy S4 so far. Either way we don't want those anomalies in our
        // stats. We'll also ignore the line in the next cycle. This doesn't
        // completely eliminate the anomalies, but it helps.
        this._ignore[id] = cur.line;
        delete stats.cpus[id];
      }
    }
    if (found) {
      this.emit('load', loads);
    }
    return (this.stats = stats);
  }

  private _error(err: Error): boolean {
    return this.emit('error', err);
  }

  private _emptyStats(): { cpus: LoadsWithLine } {
    return {
      cpus: {},
    };
  }
}
