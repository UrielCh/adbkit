import Command from '../../command.js';

export default class ReverseCommand extends Command<true> {
  async execute(remote: string, local: string): Promise<true> {
    await this._send(`reverse:forward:${remote};${local}`);
    await this.readOKAY();
    await this.readOKAY();
    return true;
  }
}
