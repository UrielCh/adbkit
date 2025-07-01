import Command from '../../command.js';

export default class WaitForDeviceCommand extends Command<string> {
  async execute(serial: string): Promise<string> {
    await this._send(`host-serial:${serial}:wait-for-any-device`);
    await this.readOKAY();
    await this.readOKAY();
    return serial;
  }
}
