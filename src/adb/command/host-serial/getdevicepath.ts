import Command from '../../command.js';

export default class GetDevicePathCommand extends Command<string> {
  async execute(serial: string): Promise<string> {
    await this._send(`host-serial:${serial}:get-devpath`);
    await this.readOKAY();
    return this.parser.readValue('utf8');
  }
}
