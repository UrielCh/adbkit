
import Protocol from '../../protocol';
import Command from '../../command';
import { Duplex } from 'stream';
import Utils from '../../../adb/util';

const symbolTimeout = Symbol('timeout')

export default class MonkeyCommand extends Command<Duplex> {
  async execute(port: number): Promise<Duplex> {
    // Some devices have broken /sdcard (i.e. /mnt/sdcard), which monkey will
    // attempt to use to write log files to. We can cheat and set the location
    // with an environment variable, because most logs use
    // Environment.getLegacyExternalStorageDirectory() like they should. There
    // are some hardcoded logs, though. Anyway, this should enable most things.
    // Check https://github.com/android/platform_frameworks_base/blob/master/
    // core/java/android/os/Environment.java for the variables.
    this._send(`shell:EXTERNAL_STORAGE=/data/local/tmp monkey --port ${port} -v`);
    const reply = await this.parser.readAscii(4);
    switch (reply) {
      case Protocol.OKAY:
        // The monkey command is a bit weird in that it doesn't look like
        // it starts in daemon mode, but it actually does. So even though
        // the command leaves the terminal "hanging", Ctrl-C (or just
        // ending the connection) will not end the daemon. HOWEVER, on
        // some devices, such as SO-02C by Sony, it is required to leave
        // the command hanging around. In any case, if the command exits
        // by itself, it means that something went wrong.
        // On some devices (such as F-08D by Fujitsu), the monkey
        // command gives no output no matter how many verbose flags you
        // give it. So we use a fallback timeout.
        const timeout = Utils.delay(1000).then(() => symbolTimeout);
        const parse = this.parser.searchLine(/^:Monkey:/);
        const race = await Promise.race([timeout, parse])
        if (race === symbolTimeout) {
          // get timeout
          return this.parser.raw();
        }
        return this.parser.raw();
      case Protocol.FAIL:
        return this.parser.readError();
      default:
        return this.parser.unexpected(reply, 'OKAY or FAIL');
    }
  }
}
