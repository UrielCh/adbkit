import Command from '../../command.js';

export default class GetSerialNoCommand extends Command<string> {
  async execute(serial: string): Promise<string> {
    await this._send(`host-serial:${serial}:get-serialno`);
    await this.readOKAY();
    return this.parser.readValue('utf8');
  }
}
