import Command from '../../command.js';
import Forward from '../../../models/Forward.js';

export default class ListForwardsCommand extends Command<Forward[]> {
  async execute(serial: string): Promise<Forward[]> {
    await this._send(`host-serial:${serial}:list-forward`);
    await this.readOKAY();
    const value = await this.parser.readValue('utf8')
    return this._parseForwards(value);
  }

  private _parseForwards(value: string): Forward[] {
    return value
      .split('\n')
      .filter((e) => e)
      .map((forward) => {
        const [serial, local, remote] = forward.split(/\s+/);
        return { serial, local, remote };
      });
  }
}
