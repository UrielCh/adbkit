import Command from '../../command.js';

const RE_OK = /restarting adbd as root/;

export default class RootCommand extends Command<true> {
  async execute(): Promise<true> {
    await this._send('root:');
    await this.readOKAY();
    const value = await this.parser.readAll();
    if (RE_OK.test(value.toString())) {
      return true;
    } else {
      throw new Error(value.toString().trim());
    }
  }
}
