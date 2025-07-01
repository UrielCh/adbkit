import Command from '../../command.js';
import { Duplex } from 'node:stream';

export default class LogCommand extends Command<Duplex> {
  async execute(name: string): Promise<Duplex> {
    await this._send(`log:${name}`);
    await this.readOKAY();
    return this.parser.raw();
  }
}
