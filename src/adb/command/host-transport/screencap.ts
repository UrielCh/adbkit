import LineTransform from '../../linetransform.js';
import { AdbPrematureEOFError } from '../../errors.js';
import Command from '../../command.js';
import { Duplex } from 'node:stream';

export default class ScreencapCommand extends Command<Duplex> {
  async execute(): Promise<Duplex> {
    this.sendCommand('shell:echo && screencap -p 2>/dev/null');
    await this.readOKAY();
    let transform = new LineTransform();
    try {
      const chunk = await this.parser.readBytes(1);
      transform = new LineTransform({ autoDetect: true });
      transform.write(chunk);
      return this.parser.raw().pipe(transform);
    } catch (err) {
      if (err instanceof AdbPrematureEOFError) {
        throw Error('No support for the screencap command');
      }
      throw err;
    }
  }
}
