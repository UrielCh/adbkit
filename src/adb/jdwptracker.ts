import EventEmitter from 'node:events';
import { AdbPrematureEOFError } from './errors.js';
import Command from './command.js';

/**
 * An object with the following properties always present:
 */
interface JdwpTrackerChangeSet {
  /**
   * An array of pids that were removed. Empty if none.
   */
  removed: string[];
  /**
   * An array of pids that were added. Empty if none.
   */
  added: string[];
}

/**
 * enforce EventEmitter typing
 */
interface IEmissions {
  /**
   * Emitted when the underlying connection ends.
   */
  end: () => void
  /**
   * **(pid)** Emitted when a JDWP process becomes unavailable, once per pid.
   */
  remove: (pid: string) => void
  /**
   * **(pid)** Emitted when a new JDWP process becomes available, once per pid.
   */
  add: (pid: string) => void
  /**
   * All changes in a single event.
   * @param changeSet An object with the following properties always present:
   * @param newList All currently active pids (including pids from previous runs).
   */
  changeSet: (changeSet: JdwpTrackerChangeSet, newList: string[]) => void
  /**
   * **(err)** Emitted if there's an error.
   */
  error: (err: Error) => void
}

export default class JdwpTracker extends EventEmitter {
  private pids: string[] = [];
  private pidMap = Object.create(null);
  // private reader: Promise<JdwpTracker | boolean>;

  constructor(private command: Command<JdwpTracker>) {
    super();
    this.command = command;
    this.pids = [];
    this.pidMap = Object.create(null);
    // this.reader = 
    this.read().catch(err => {
      if (err instanceof AdbPrematureEOFError) {
        return this.emit('end');
      }
      this.command.connection.end();
      this.emit('error', err);
      return this.emit('end');
    });
  }

  public override on = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.on(event, listener)
  public override off = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.off(event, listener)
  public override once = <K extends keyof IEmissions>(event: K, listener: IEmissions[K]): this => super.once(event, listener)
  public override emit = <K extends keyof IEmissions>(event: K, ...args: Parameters<IEmissions[K]>): boolean => super.emit(event, ...args)

  async read(): Promise<JdwpTracker> {
    const list = await this.command.parser.readValue('utf8');
    const pids = list.split('\n');
    const maybeEmpty = pids.pop();
    if (maybeEmpty) {
      pids.push(maybeEmpty);
    }
    return this.update(pids);
  }

  update(newList: string[]): JdwpTracker {
    const changeSet: JdwpTrackerChangeSet = {
      removed: [],
      added: [],
    };
    const newMap = Object.create(null);
    for (let i = 0, len = newList.length; i < len; i++) {
      const pid = newList[i];
      if (!this.pidMap[pid]) {
        changeSet.added.push(pid);
        this.emit('add', pid);
        newMap[pid] = pid;
      }
    }
    const ref = this.pids;
    for (let j = 0, len1 = ref.length; j < len1; j++) {
      const pid = ref[j];
      if (!newMap[pid]) {
        changeSet.removed.push(pid);
        this.emit('remove', pid);
      }
    }
    this.pids = newList;
    this.pidMap = newMap;
    this.emit('changeSet', changeSet, newList);
    return this;
  }

  end(): JdwpTracker {
    return this;
  }
}
