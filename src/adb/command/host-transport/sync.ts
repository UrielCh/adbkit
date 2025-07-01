import Sync from '../../sync.js';
import Command from '../../command.js';

export default class SyncCommand extends Command<Sync> {
  async execute(): Promise<Sync> {
    await this._send('sync:');
    await this.readOKAY();
    return new Sync(this.connection);
  }
}
