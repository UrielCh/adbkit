import { AdbPrematureEOFError } from '../../errors.js';
import Command from '../../command.js';

export default class IsInstalledCommand extends Command<boolean> {
  async execute(pkg: string): Promise<boolean> {
    await this._send(`shell:pm path ${pkg} 2>/dev/null`);
    await this.readOKAY();
    try {
      const reply = await this.parser.readAscii(8);
      switch (reply) {
        case 'package:':
          return true;
        default:
          throw this.parser.unexpected(reply, "'package:'");
      }
    } catch (err) {
      if (err instanceof AdbPrematureEOFError) {
        return false;
      }
      throw err;
    }
  }
}
