import LineTransform from '../../linetransform.js';
import Command from '../../command.js';

export default class LogcatCommand extends Command<LineTransform> {
  async execute(options: { clear?: boolean } = {}): Promise<LineTransform> {
    // For some reason, LG G Flex requires a filter spec with the -B option.
    // It doesn't actually use it, though. Regardless of the spec we always get
    // all events on all devices.
    let cmd = 'logcat -B *:I 2>/dev/null';
    if (options.clear) {
      cmd = `logcat -c 2>/dev/null && ${cmd}`;
    }
    this.sendCommand(`shell:echo && ${cmd}`);
    await this.readOKAY();
    return this.parser.raw().pipe(
      new LineTransform({
        autoDetect: true,
      }));
  }
}
