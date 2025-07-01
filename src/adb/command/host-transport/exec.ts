import Command from '../../command.js';
import { Duplex } from 'node:stream';
import WithToString from '../../../models/WithToString.js';

export default class ExecCommand extends Command<Duplex> {
  async execute(command: string | ArrayLike<WithToString>): Promise<Duplex> {
    if (Array.isArray(command)) {
      command = command.map(this.escape).join(' ');
    }
    this.sendCommand(`exec:${command}`);
    await this.readOKAY();
    return this.parser.raw();
  }
}
