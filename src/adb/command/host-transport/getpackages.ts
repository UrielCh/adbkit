import Command from '../../command.js';

const RE_SAFE_FLAG = /^[a-zA-Z0-9_@%+=:,./-]+$/;

export default class GetPackagesCommand extends Command<string[]> {
  async execute(...flags: string[]): Promise<string[]> {
    const args = this._normalizeFlags(flags);
    if (args.length) {
      await this.sendCommand(`shell:pm list packages ${args.join(' ')} 2>/dev/null`);
    } else {
      await this.sendCommand('shell:pm list packages 2>/dev/null');
    }
    await this.readOKAY();
    const data = await this.parser.readAll();
    return this._parsePackages(data.toString());
  }

  private _normalizeFlags(flags: string[]): string[] {
    if (!flags.length) {
      return [];
    }
    const rawArgs = flags.length === 1 ? flags[0].trim().split(/\s+/) : flags;
    const escaped: string[] = [];
    for (const arg of rawArgs) {
      if (!arg) {
        continue;
      }
      escaped.push(RE_SAFE_FLAG.test(arg) ? arg : String(this.escape(arg)));
    }
    return escaped;
  }

  private _parsePackages(value: string): string[] {
    const packages: string[] = [];
    const RE_PACKAGE = /^package:(.*?)\r?$/gm;
    for (; ;) {
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
