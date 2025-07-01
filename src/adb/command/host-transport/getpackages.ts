import Command from '../../command.js';

export default class GetPackagesCommand extends Command<string[]> {
  async execute(flags?: string): Promise<string[]> {
    if (flags) {
      this.sendCommand(`shell:pm list packages ${flags} 2>/dev/null`);
    } else {
      this.sendCommand('shell:pm list packages 2>/dev/null');
    }
    await this.readOKAY();
    const data = await this.parser.readAll();
    return this._parsePackages(data.toString());
  }

  private _parsePackages(value: string): string[] {
    const packages: string[] = [];
    const RE_PACKAGE = /^package:(.*?)\r?$/gm;
    for (;;) {
      const match = RE_PACKAGE.exec(value);
      if (match) {
        packages.push(match[1]);
      } else {
        break;
      }
    }
    return packages;
  }
}
