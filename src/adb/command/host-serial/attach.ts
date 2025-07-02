import Command from '../../command.js';

export default class AttachCommand extends Command<boolean> {
  async execute(serial: string): Promise<boolean> {
    await this._send(`host-serial:${serial}:attach`);
    await this.readOKAY();
    return true;
  }
}
