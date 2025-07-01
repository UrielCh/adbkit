import Command from '../../command.js';

export default class ForwardCommand extends Command<boolean> {
  async execute(serial: string, local: string, remote: string): Promise<boolean> {
    await this._send(`host-serial:${serial}:forward:${local};${remote}`);
    await this.readOKAY();
    await this.readOKAY();
    return true;
  }
}
