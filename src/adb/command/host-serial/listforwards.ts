import Command from '../../command';
import Protocol from '../../protocol';
import Forward from '../../../Forward';

export default class ListForwardsCommand extends Command<Forward[]> {
  async execute(serial: string): Promise<Forward[]> {
    this._send(`host-serial:${serial}:list-forward`);
    const reply = await this.parser.readAscii(4);
    switch (reply) {
      case Protocol.OKAY:
        return this.parser.readValue().then(this._parseForwards);
      case Protocol.FAIL:
        return this.parser.readError();
      default:
        return this.parser.unexpected(reply, 'OKAY or FAIL');
    }
  }

  private _parseForwards(value: Buffer): Forward[] {
    return value
      .toString()
      .split('\n')
      .filter((e) => e)
      .map((forward) => {
        const [serial, local, remote] = forward.split(/\s+/);
        return { serial, local, remote };
      });
  }
}
