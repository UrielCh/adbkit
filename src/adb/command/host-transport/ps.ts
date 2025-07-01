import Command from '../../command.js';

/**
 * usage: ps [-AadefLlnwZ] [-gG GROUP,] [-k FIELD,] [-o FIELD,] [-p PID,] [-t TTY,] [-uU USER,]
 *
 * List processes.
 *
 * Which processes to show (-gGuUpPt selections may be comma separated lists):
 *
 * -A  All                                 -a  Has terminal not session leader
 * -d  All but session leaders             -e  Synonym for -A
 * -g  In GROUPs                           -G  In real GROUPs (before sgid)
 * -p  PIDs (--pid)                        -P  Parent PIDs (--ppid)
 * -s  In session IDs                      -t  Attached to selected TTYs
 * -T  Show threads also                   -u  Owned by selected USERs
 * -U  Real USERs (before suid)
 *
 * Output modifiers:
 *
 * -k  Sort FIELDs (-FIELD to reverse)     -M  Measure/pad future field widths
 * -n  Show numeric USER and GROUP         -w  Wide output (don't truncate fields)
 *
 * Which FIELDs to show. (-o HELP for list, default = -o PID,TTY,TIME,CMD)
 *
 * -f  Full listing (-o USER:12=UID,PID,PPID,C,STIME,TTY,TIME,ARGS=CMD)
 * -l  Long listing (-o F,S,UID,PID,PPID,C,PRI,NI,ADDR,SZ,WCHAN,TTY,TIME,CMD)
 * -o  Output FIELDs instead of defaults, each with optional :size and =title
 * -O  Add FIELDS to defaults
 * -Z  Include LABEL
 */
export default class PsCommand extends Command<Array<Partial<PsEntry>>> {
  async execute(...args: string[]): Promise<Array<Partial<PsEntry>>> {
    if (!args.length) {
      this.sendCommand(`shell:ps`); //  2>/dev/null
    } else {
      this.sendCommand(`shell:ps ${args.join(' ')}`); //  2>/dev/null
    }
    await this.readOKAY();
    const data = await this.parser.readAll()
    return this._parsePs(data.toString());
  }

  private _parsePs(value: string): Array<Partial<PsEntry>> {
    const lines: string[] = value.split(/[\r\n]+/g);
    const titles = (lines.shift() || '').trim();
    const cols = titles.split(/\s+/g) as Array<keyof PsEntry>;
    const result: Partial<PsEntry>[] = [];
    for (const line of lines) {
      if (!line)
        continue;
      const ps: Partial<PsEntry> = {};
      let p = 0;
      const last = cols.length - 1;
      for (let i = 0; i < last; i++) {
        const p2 = line.indexOf(' ', p);
        (ps as { [key: string]: string })[cols[i]] = line.substring(p, p2);
        p = p2 + 1;
        while (line[p] == ' ') p++;
      }
      (ps as { [key: string]: string })[cols[last]] = line.substring(p);
      result.push(ps);
    }
    return result;
  }
}

/**
 * R (running) S (sleeping) D (device I/O) T (stopped)  t (trace stop)
 * X (dead)    Z (zombie)   P (parked)     I (idle)
 * Also between Linux 2.6.33 and 3.13:
 * x (dead)    K (wakekill) W (waking)
 */
export type ProcessState = 'R' | 'S' | 'D' | 'T' | 't' | 'X' | 'Z' | 'P' | 'I' | 'x' | 'K' | 'W';

/**
 * contains PS command line
 */
export interface PsEntry {
  // Command line field types:
  ARGS: string; //    CMDLINE minus initial path
  CMD: string; //     Thread name (/proc/TID/stat:2)
  CMDLINE: string; // Command line (argv[])
  COMM: string; //    EXE filename (/proc/PID/exe)
  COMMAND: string; // EXE path (/proc/PID/exe)
  NAME: string; //    Process name (PID's argv[0])
  // Process attribute field types:
  S: ProcessState; // Process state:
  SCH: '0' | '1' | '2' | '3' | '4' | '5'; //     Scheduling policy (0=other, 1=fifo, 2=rr, 3=batch, 4=iso, 5=idle)
  STAT: string; //    Process state (S) plus:
  // < high priority          N low priority L locked memory
  // s session leader         + foreground   l multithreaded
  '%CPU': string; //  Percentage of CPU time used
  '%MEM': string; //  RSS as % of physical memory
  '%VSZ': string; //  VSZ as % of physical memory
  ADDR: string; //    Instruction pointer
  BIT: string; //     32 or 64
  C: string; //       Total %CPU used since start
  CPU: string; //     Which processor running on
  DIO: string; //     Disk I/O
  DREAD: string; //   Data read from disk
  DWRITE: string; //  Data written to disk
  ELAPSED: string; // Elapsed time since PID start
  F: string; //       Flags 1=FORKNOEXEC 4=SUPERPRIV
  GID: string; //     Group ID
  GROUP: string; //   Group name
  IO: string; //      Data I/O
  LABEL: string; //   Security label
  MAJFL: string; //   Major page faults
  MINFL: string; //   Minor page faults
  NI: string; //      Niceness (static 19 to -20)
  PCY: string; //     Android scheduling policy
  PGID: string; //    Process Group ID
  PID: string; //     Process ID
  PPID: string; //    Parent Process ID
  PR: string; //      Prio Reversed (dyn 39-0, RT)
  PRI: string; //     Priority (dynamic 0 to 139)
  PSR: string; //     Processor last executed on
  READ: string; //    Data read
  RES: string; //     Short RSS
  RGID: string; //    Real (before sgid) Group ID
  RGROUP: string; //  Real (before sgid) group name
  RSS: string; //     Resident Set Size (DRAM pages)
  RTPRIO: string; //  Realtime priority
  RUID: string; //    Real (before suid) user ID
  RUSER: string; //   Real (before suid) user name
  SHR: string; //     Shared memory
  STIME: string; //   Start time (ISO 8601)
  SWAP: string; //    Swap I/O
  SZ: string; //      4k pages to swap out
  TCNT: string; //    Thread count
  TID: string; //     Thread ID
  TIME: string; //    CPU time consumed
  'TIME+': string; //   CPU time (high precision)
  TTY: string; //     Controlling terminal
  UID: string; //     User id
  USER: string; //    User name
  VIRT: string; //    Virtual memory size
  VSZ: string; //     Virtual memory size (1k units)
  WCHAN: string; //   Wait location in kernel
  WRITE: string; //   Data written
}
