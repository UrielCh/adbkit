import Command from '../../command.js';

export interface UninstallCommandOptions {
  /**
   * keep the data and cache directories around after package removal.
   */
  keep?: boolean;
  /**
   * remove the app from the given user.
   */
  user?: string | number;
  /**
   * only uninstall if the app has the given version code.
   */
  versionCode?: string;
}

class UninstallError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export default class UninstallCommand extends Command<boolean> {
  async execute(pkg: string, opts?: UninstallCommandOptions): Promise<boolean> {
    let cmd = 'shell:pm uninstall';
    if (opts) {
      if (opts.keep) cmd += ' -k';
      if (opts.user) cmd += ` --user ${opts.user}`;
      if (opts.versionCode) cmd += ` --versionCode ${opts.versionCode}`;
    }
    cmd += ` ${pkg}`
    this.sendCommand(cmd);
    await this.readOKAY();
    try {
      const match = await this.parser.searchLine(/^(Success|Failure.*|.*Unknown package:.*)$/);
      if (match[1] === 'Success') {
        return true;
      } else if (match[1].includes('DELETE_FAILED_DEVICE_POLICY_MANAGER')) {
        // @see https://github.com/DeviceFarmer/adbkit/pull/513
        const reason = match[1];
        throw new UninstallError(`${pkg} could not be uninstalled [${reason}]`);
      } else {
        // Either way, the package was uninstalled or doesn't exist,
        // which is good enough for us.
        return true;
      }
    } finally {
      this.parser.readAll();
    }
  }
}
