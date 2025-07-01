import { AdbPrematureEOFError } from '../../errors.js';
import Command from '../../command.js';
import StartActivityOptions from '../../../models/StartActivityOptions.js';
import { Extra, ExtraObject, ExtraValue } from '../../../models/StartServiceOptions.js';

const RE_ERROR = /^Error: (.*)$/;

const EXTRA_TYPES = {
  string: 's',
  null: 'sn',
  bool: 'z',
  int: 'i',
  long: 'l',
  float: 'f',
  uri: 'u',
  component: 'cn',
};

export default class StartActivityCommand extends Command<boolean> {
  execute(options: StartActivityOptions): Promise<boolean> {
    const args = this._intentArgs(options);
    if (options.debug) {
      args.push('-D');
    }
    if (options.wait) {
      args.push('-W');
    }
    if (options.user || options.user === 0) {
      args.push('--user', this.escape(options.user));
    }
    return this._run('start', args);
  }

  async _run(command: string, args: Array<string | number>): Promise<boolean> {
    this.sendCommand(`shell:am ${command} ${args.join(' ')}`);
    await this.readOKAY();
    try {
      const match = await this.parser.searchLine(RE_ERROR);
      throw new Error(match[1]);
    } catch (err) {
      if (err instanceof AdbPrematureEOFError)
        return true;
    } finally {
      this.parser.end();
    }
    // may be incorrect.
    throw await this.parser.readError();
  }

  protected _intentArgs(options: StartActivityOptions): Array<string | number> {
    const args: Array<string | number> = [];
    if (options.extras) {
      args.push(...this._formatExtras(options.extras));
    }
    if (options.action) {
      args.push('-a', this.escape(options.action));
    }
    if (options.data) {
      args.push('-d', this.escape(options.data));
    }
    if (options.mimeType) {
      args.push('-t', this.escape(options.mimeType));
    }
    if (options.category) {
      if (Array.isArray(options.category)) {
        options.category.forEach((category) => {
          return args.push('-c', this.escape(category));
        });
      } else {
        args.push('-c', this.escape(options.category));
      }
    }
    if (options.component) {
      args.push('-n', this.escape(options.component));
    }
    if (options.flags) {
      args.push('-f', this.escape(options.flags));
    }
    if (options.args) {
      if (typeof options.args === 'string')
        args.push(this.escape(options.args));
      else
        for (const arg of options.args)
          args.push(this.escape(arg));
    }
    return args;
  }

  // StartActivityOptions['extras']
  private _formatExtras(extras: Extra[] | ExtraObject): Array<number | string> {
    if (!extras) {
      return [];
    }
    if (Array.isArray(extras)) {
      return extras.reduce((all, extra) => {
        return all.concat(this._formatLongExtra(extra));
      }, [] as Array<number | string>);
    } else {
      return Object.keys(extras).reduce((all, key) => {
        return all.concat(this._formatShortExtra(key, extras[key]));
      }, [] as Array<number | string>);
    }
  }

  private _formatShortExtra(key: string, value: ExtraValue): Array<string | number> {
    let sugared: Extra = {
      key: key,
      type: 'null',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value: undefined,
    };
    if (value === null) {
      sugared.type = 'null';
    } else if (Array.isArray(value)) {
      throw new Error(
        `Refusing to format array value '${key}' using short syntax; empty array would cause unpredictable results due to unknown type. Please use long syntax instead.`,
      );
    } else {
      switch (typeof value) {
        case 'string':
          sugared.type = 'string';
          sugared.value = value;
          break;
        case 'boolean':
          sugared.type = 'bool';
          sugared.value = value;
          break;
        case 'number':
          sugared.type = 'int';
          sugared.value = value;
          break;
        case 'object':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sugared = value as any as Extra;
          sugared.key = key;
      }
    }
    return this._formatLongExtra(sugared);
  }

  private _formatLongExtra(extra: Extra): Array<string | number> {
    const args: Array<string | number> = [];
    if (!extra.type) {
      extra.type = 'string';
    }
    const type = EXTRA_TYPES[(extra as Extra).type];
    if (!type) {
      throw new Error(`Unsupported type '${extra.type}' for extra '${extra.key}'`);
    }
    if (extra.type === 'null') {
      args.push(`--e${type}`);
      args.push(this.escape(extra.key));
    } else if (Array.isArray(extra.value)) {
      args.push(`--e${type}a`);
      args.push(this.escape(extra.key));
      args.push(this.escape(extra.value.join(',')));
    } else {
      //if (extra.value) {
      args.push(`--e${type}`);
      args.push(this.escape(extra.key));
      if (extra.value)
        args.push(this.escape(extra.value));
      //}
    }
    return args;
  }
}
