import Command from '../../command.js';

/**
 *  install [-rtfdgw] [-i PACKAGE] [--user USER_ID|all|current]
 *     [-p INHERIT_PACKAGE] [--install-location 0/1/2]
 *     [--install-reason 0/1/2/3/4] [--originating-uri URI]
 *     [--referrer URI] [--abi ABI_NAME] [--force-sdk]
 *     [--preload] [--instant] [--full] [--dont-kill]
 *     [--enable-rollback]
 *     [--force-uuid internal|UUID] [--pkg PACKAGE] [-S BYTES]
 *     [--apex] [--wait TIMEOUT]
 *     [PATH [SPLIT...]|-]
 *  Install an application.  Must provide the apk data to install, either as
 *  file path(s) or '-' to read from stdin.  Options are:
 *    -R: disallow replacement of existing application
 *    -t: allow test packages
 *    -i: specify package name of installer owning the app
 *    -f: install application on internal flash
 *    -d: allow version code downgrade (debuggable packages only)
 *    -p: partial application install (new split on top of existing pkg)
 *    -g: grant all runtime permissions
 *    -S: size in bytes of package, required for stdin
 *    --user: install under the given user.
 *    --dont-kill: installing a new feature split, don't kill running app
 *    --restrict-permissions: don't whitelist restricted permissions at install
 *    --originating-uri: set URI where app was downloaded from
 *    --referrer: set URI that instigated the install of the app
 *    --pkg: specify expected package name of app being installed
 *    --abi: override the default ABI of the platform
 *    --instant: cause the app to be installed as an ephemeral install app
 *    --full: cause the app to be installed as a non-ephemeral full app
 *    --install-location: force the install location:
 *        0=auto, 1=internal only, 2=prefer external
 *    --install-reason: indicates why the app is being installed:
 *        0=unknown, 1=admin policy, 2=device restore,
 *        3=device setup, 4=user request
 *    --force-uuid: force install on to disk volume with given UUID
 *    --apex: install an .apex file, not an .apk
 *    --wait: when performing staged install, wait TIMEOUT milliseconds
 *        for pre-reboot verification to complete. If TIMEOUT is not
 *        specified it will wait for 60000 milliseconds.
 */
export default class InstallCommand extends Command<boolean> {
  async execute(apk: string): Promise<boolean> {
    this.sendCommand(`shell:pm install -r ${this.escapeCompat(apk)}`);
    await this.readOKAY();
    try {
      const match = await this.parser.searchLine(/^(Success|Failure \[(.*?)\])$/);
      if (match[1] === 'Success') {
        return true;
      } else {
        const code = match[2];
        const err = new Error(`${apk} could not be installed [${code}]`);
        (err as Error & {code: string}).code = code;
        throw err;
      }
    } finally {
      // Consume all remaining content to "naturally" close the
      // connection.
      this.parser.readAll();
    }
  }
}
