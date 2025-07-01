import Command from '../../command.js';

// Possible replies:
// "No such device 192.168.2.2:5555"
// ""
// "disconnected 192.168.2.2:5555"

const RE_OK = /^$/;
const RE_DISC = /^disconnected.*$/

export default class HostDisconnectCommand extends Command<string> {
  async execute(host: string, port: number): Promise<string> {
    await this._send(`host:disconnect:${host}:${port}`);
    await this.readOKAY();
    const value = await this.parser.readValue("ascii");
    if (RE_OK.test(value) || RE_DISC.test(value)) {
      return `${host}:${port}`;
    } else {
      throw new Error(value);
    }
  }
}
