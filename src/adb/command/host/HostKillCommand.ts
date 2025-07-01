import Command from '../../command.js';

export default class HostKillCommand extends Command<boolean> {
  async execute(): Promise<boolean> {
    await this._send('host:kill');
    await this.readOKAY();
    return true;
  }
}
