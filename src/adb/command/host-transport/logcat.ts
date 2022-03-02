import LineTransform from '../../linetransform';
import Protocol from '../../protocol';
import Command from '../../command';

// FIXME(intentional any): not "any" will break it all
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default class LogcatCommand extends Command<any> {
  async execute(options: { clear?: boolean } = {}): Promise<LineTransform> {
    // For some reason, LG G Flex requires a filter spec with the -B option.
    // It doesn't actually use it, though. Regardless of the spec we always get
    // all events on all devices.
    let cmd = 'logcat -B *:I 2>/dev/null';
    if (options.clear) {
      cmd = `logcat -c 2>/dev/null && ${cmd}`;
    }
    this._send(`shell:echo && ${cmd}`);
    const reply = await this.parser.readAscii(4);
    switch (reply) {
      case Protocol.OKAY:
        return this.parser.raw().pipe(
          new LineTransform({
            autoDetect: true,
          }));
      case Protocol.FAIL:
        return this.parser.readError();
      default:
        return this.parser.unexpected(reply, 'OKAY or FAIL');
    }
  }
}
