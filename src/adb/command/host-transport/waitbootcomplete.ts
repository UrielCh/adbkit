import Command from '../../command';

export default class WaitBootCompleteCommand extends Command<boolean> {
  async execute(): Promise<boolean> {
    this._send('shell:while getprop sys.boot_completed 2>/dev/null; do sleep 1; done');
    await this.readOKAY();
    try {
      await this.parser.searchLine(/^1$/);
    } finally {
      this.parser.end()
    }
    return true;
  }
}
