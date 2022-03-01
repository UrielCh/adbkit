import Protocol from '../../protocol';
import Command from '../../command';

export default class UninstallCommand extends Command<boolean> {
  async execute(pkg: string): Promise<boolean> {
    this._send(`shell:pm uninstall ${pkg}`);
    const reply = await this.parser.readAscii(4);
    switch (reply) {
      case Protocol.OKAY:
        return this.parser
          .searchLine(/^(Success|Failure.*|.*Unknown package:.*)$/)
          .then(function (match) {
            if (match[1] === 'Success') {
              return true;
            } else {
              // Either way, the package was uninstalled or doesn't exist,
              // which is good enough for us.
              return true;
            }
          })
          .finally(() => {
            // Consume all remaining content to "naturally" close the
            // connection.
            return this.parser.readAll();
          });
      case Protocol.FAIL:
        return this.parser.readError();
      default:
        return this.parser.unexpected(reply, 'OKAY or FAIL');
    }
  }
}
