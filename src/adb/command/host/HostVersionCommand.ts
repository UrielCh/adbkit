import Command from '../../command.js';
import Protocol from '../../protocol.js';

export default class HostVersionCommand extends Command<number> {
  async execute(): Promise<number> {
    await this._send('host:version');
    const reply = await this.parser.readAscii(4);
    switch (reply) {
      case Protocol.OKAY:
        const value = await this.parser.readValue('utf8');
        return this._parseVersion(value);
      case Protocol.FAIL:
        throw await this.parser.readError();
      default:
        return this._parseVersion(reply);
    }
  }

  _parseVersion(version: string): number {
    return parseInt(version, 16);
  }
}
