import Command from '../../command.js';

export default class KillForwardCommand extends Command<boolean> {
  async execute(serial: string, local: string): Promise<boolean> {
    await this._send(`host-serial:${serial}:killforward:${local}`);
    await this.readOKAY();
    await this.readOKAY();
    return true;
  }
}
