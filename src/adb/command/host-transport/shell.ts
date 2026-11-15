import Command from '../../command.js';
import { Duplex } from 'node:stream';
import WithToString from '../../../models/WithToString.js';

export default class ShellCommand extends Command<Duplex> {
  async execute(command: string | ArrayLike<WithToString>): Promise<Duplex> {
    if (typeof command !== 'string') {
      command = Array.from(command, this.escape).join(' ');
    }
    await this.sendCommand(`shell:${command}`);
    await this.readOKAY();
    return this.parser.raw();
  }
}
