import Protocol from '../../protocol';
import Command from '../../command';

export default class InstallCommand extends Command<boolean> {
  async execute(apk: string): Promise<boolean> {
    this._send(`shell:pm install -r ${this._escapeCompat(apk)}`);
    const reply = await this.parser.readAscii(4);
    switch (reply) {
      case Protocol.OKAY:
        return this.parser
          .searchLine(/^(Success|Failure \[(.*?)\])$/)
          .then(function (match) {
            let code, err;
            if (match[1] === 'Success') {
              return true;
            } else {
              code = match[2];
              err = new Error(`${apk} could not be installed [${code}]`);
              err.code = code;
              throw err;
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
