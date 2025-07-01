import Command from '../../command.js';

// Possible replies:
// "unable to connect to 192.168.2.2:5555"
// "connected to 192.168.2.2:5555"
// "already connected to 192.168.2.2:5555"
const RE_OK = /connected to|already connected/;

export default class HostConnectCommand extends Command<boolean> {
  async execute(host: string, port: number): Promise<boolean> {
    await this._send(`host:connect:${host}:${port}`);
    await this.readOKAY();
    const value = await this.parser.readValue('utf8');
    if (RE_OK.test(value)) {
      if (value.includes("already connected"))
        return false;
      else
        return true;
    } else {
      throw new Error(value);
    }
  }
}
