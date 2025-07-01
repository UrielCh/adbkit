import Command from '../../command.js';

export default class RemountCommand extends Command<true> {
  async execute(): Promise<true> {
    await this._send('remount:');
    await this.readOKAY();
    return true;
  }
}
