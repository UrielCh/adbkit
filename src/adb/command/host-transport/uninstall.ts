import Command from '../../command.js';

export interface UninstallCommandOptions {
  /**
   * keep the data and cache directories around after package removal.
   */
  keep?: boolean;
  /**
   * remove the app from the given user.
   */
  user?: string | number | null;
  /**
   * only uninstall if the app has the given version code.
   */
  versionCode?: string;
  /**
   * throw an `UninstallError` on any uninstall failure instead of returning `true`
   * (note: `DELETE_FAILED_DEVICE_POLICY_MANAGER` always throws regardless of this option).
   */
  throwOnFailure?: boolean;
}

export class UninstallError extends Error {
  public readonly reason: string;
  public readonly code?: string;
  public readonly isNotInstalled: boolean;

  constructor(message: string, reason = '') {
    super(message);
    this.name = 'UninstallError';
    this.reason = reason;
    this.code = /\[([^\]]+)\]/.exec(reason)?.[1];
    this.isNotInstalled = /not installed|Unknown package:|DELETE_FAILED_NOT_INSTALLED/i.test(reason);
  }
}

export default class UninstallCommand extends Command<boolean> {
  async execute(pkg: string, opts?: UninstallCommandOptions): Promise<boolean> {
    let cmd = 'shell:pm uninstall';
    if (opts) {
      if (opts.keep) cmd += ' -k';
      if (opts.user !== undefined && opts.user !== null) cmd += ` --user ${this.escape(opts.user)}`;
      if (opts.versionCode) cmd += ` --versionCode ${this.escape(opts.versionCode)}`;
    }
    cmd += ` ${this.escape(pkg)}`;
    await this.sendCommand(cmd);
    await this.readOKAY();
    try {
      const match = await this.parser.searchLine(/^(Success|Failure.*|.*Unknown package:.*)$/);
      if (match[1] === 'Success') {
        return true;
      } else if (match[1].includes('DELETE_FAILED_DEVICE_POLICY_MANAGER') || opts?.throwOnFailure) {
        // @see https://github.com/DeviceFarmer/adbkit/pull/513
        const reason = match[1];
        throw new UninstallError(`${pkg} could not be uninstalled [${reason}]`, reason);
      } else {
        // Legacy default: either way, the package was uninstalled or doesn't exist,
        // which is good enough unless `throwOnFailure` is requested.
        return true;
      }
    } finally {
      await this.parser.readAll();
    }
  }
}
