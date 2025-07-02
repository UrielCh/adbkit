import Command from '../../command.js';

export default class DetachCommand extends Command<boolean> {
  async execute(serial: string): Promise<boolean> {
    await this._send(`host-serial:${serial}:detach`);
    await this.readOKAY();
    return true;
  }
}
