import Command from '../../command.js';

const RE_OK = /restarting in/;

export default class TcpIpCommand extends Command<number> {
  async execute(port: number): Promise<number> {
    await this._send(`tcpip:${port}`);
    await this.readOKAY();
    const value = await this.parser.readAll()
    if (RE_OK.test(value.toString())) {
      return port;
    } else {
      throw new Error(value.toString().trim());
    }
  }
}
