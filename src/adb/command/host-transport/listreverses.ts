import Command from '../../command.js';
import Reverse from '../../../models/Reverse.js';

export default class ListReversesCommand extends Command<Reverse[]> {
  async execute(): Promise<Reverse[]> {
    await this._send('reverse:list-forward');
    await this.readOKAY();
    const value = await this.parser.readValue('utf8')
    return this._parseReverses(value);
  }

  private _parseReverses(value: string): Reverse[] {
    const reverses: Reverse[] = [];
    const ref = value.split('\n');
    for (let i = 0, len = ref.length; i < len; i++) {
      const reverse = ref[i];
      if (reverse) {
        const [, remote, local] = reverse.split(/\s+/);
        reverses.push({ remote, local });
      }
    }
    return reverses;
  }
}
