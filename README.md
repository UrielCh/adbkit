# adbkit

[![NPM Version](https://img.shields.io/npm/v/@u4/adbkit.svg?style=flat)](https://www.npmjs.org/package/@u4/adbkit)

**adbkit** is a pure [Node.js][nodejs] client for the [Android Debug Bridge][adb-site] server. It can be used either as a library in your own application, or simply as a convenient utility for playing with your device.

Most of the `adb` command line tool's functionality is supported (including pushing/pulling files, installing APKs and processing logs), with some added functionality such as being able to generate touch/key events and take screenshots. Some shims are provided for older devices, but we have not and will not test anything below Android 2.3.

Internally, we use this library to drive a multitude of Android devices from a variety of manufacturers, so we can say with a fairly high degree of confidence that it will most likely work with your device(s), too.

## Requirements

*   [Node.js][nodejs] >= 22.0.0
*   Either the optional ya-webadb dependencies described below, or the `adb` command line tool

With the native ADB backend, the target host (where the devices are connected) must have the ADB server running (e.g. via `adb start-server`) or the `adb` binary available in `$PATH`. If the initial connection is refused, adbkit attempts to start the server locally.

When targeting a remote host, starting the server is entirely your responsibility.

For Linux users, adb need `plugdev` group access, So you may need to add your current user to `plugdev` group.
`sudo usermod -a -G plugdev $USER`

## Getting started

Install via NPM:

```bash
npm install --save @u4/adbkit
```

### Optional ya-webadb backend

adbkit can use [ya-webadb](https://www.npmjs.com/package/@yume-chan/adb) in-process to communicate with devices, without a native ADB server or binary. Its four dependencies are declared as optional dependencies of adbkit and are normally installed automatically. If they were omitted or failed to install, install them in your application:

```bash
npm install @yume-chan/adb@^3.0.0-beta.5 @yume-chan/adb-daemon-webusb@^3.0.0-beta.5 @yume-chan/adb-credential-nodejs@^3.0.0-beta.5 usb@^3.3.0
```

In `auto` mode (the default), `createClient()` selects this backend for a local host when all four packages can be loaded; otherwise it uses the native server. Enable USB debugging and authorize the computer on the device when prompted. USB access also requires appropriate operating system permissions.

You can check whether the packages loaded and explicitly select a backend:

```typescript
import { createClient, isYaWebAdbAvailable } from '@u4/adbkit';

console.log('ya-webadb available:', await isYaWebAdbAvailable());
const client = createClient({ backend: 'native' }); // Native ADB server
// Or: createClient({ backend: 'ya-webadb' }); // Requires the optional packages
```

`backend: 'ya-webadb'` fails if its optional packages cannot be loaded. Availability checks only package loading, not device access or authorization. In `auto` mode, a remote `host` uses the native server.

The native ADB server can hold an exclusive USB device lock. By default, ya-webadb leaves that server running and a busy device cannot be opened. To allow adbkit to stop the local native server and retry, set `stopNativeAdbServerOnUsbBusy: true` when creating the client. This can interrupt other applications using that server.

We use [debug][node-debug], and our debug namespace is `adb`. Some of the dependencies may provide debug output of their own. To see the debug output, set the `DEBUG` environment variable. For example, run your program with `DEBUG=adb:* node app.js`.

### Getting started sample

```typescript
import { createClient } from '@u4/adbkit';

const main = async () => {
  const adbClient = createClient();
  const devices = await adbClient.listDevices();
  if (!devices.length) {
    console.error('Need at least one connected android device');
    return;
  }
  // deviceClient is a DeviceClient
  const deviceClient = devices[0].getClient();
  // your device is ready to use
  // check all DeviceClient functions
  // print Hello World in a shell and get the echo back
  const hello = await deviceClient.execOut('echo Hello World', 'utf8');
  console.log(hello);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

[full documentation is available here](https://urielch.github.io/adbkit/)


## Incompatible changes in version 5.x

- the project only contains ESM modules
- all enum values are replaced by a const TypeMap as const and a type having the same name as the enum
  - example `enum KeyCodes` => `KeyCodesMap` and `type KeyCodes`

## Incompatible changes in version 3.x

- Previously, adbKit was based on Bluebird, It's now based on native Promise some Bluebird Promise cannelation is not compatible with ES6 Promises.
- v4 is Object oriented functions taking a serial as first parameter had been moved to DeviceClient

## More information

*   [Android Debug Bridge][adb-site]
   *   [SERVICES.TXT][adb-services] (ADB socket protocol)
*   [Android ADB Protocols][adb-protocols] (a blog post explaining the protocol)
*   [adb.js][adb-js] (another Node.js ADB implementation)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

The unit suite runs with `npm test`. To run the native-backend integration check, start one Android emulator or connect an authorized device, ensure `adb devices` lists it as `device`, then run `npm run test:integration`. If multiple devices are connected, set `ADB_SERIAL` to select one. The check creates and removes a temporary file under `/data/local/tmp` and a local TCP forward. A scheduled and manually triggered CI workflow runs it on an Android emulator.

For USB backend changes, also test on a physical device: authorize a new computer, disconnect and reconnect the device, check an unauthorized device, and exercise transfers and forwarding. With the native server holding the device, verify the default leaves it running and that `stopNativeAdbServerOnUsbBusy: true` permits a retry. Repeat on the operating systems and Android versions relevant to the release.

## License

API documentation can be generated locally with `bun run docs`. The documentation workflow builds and publishes it on pushes to `master`; configure the repository's GitHub Pages source as **GitHub Actions** to enable publishing.

See [LICENSE](LICENSE).

[nodejs]: http://nodejs.org/

[npm]: https://npmjs.org/

[adb-js]: https://github.com/flier/adb.js

[adb-site]: http://developer.android.com/tools/help/adb.html

[adb-services]: https://github.com/android/platform_system_core/blob/master/adb/SERVICES.TXT

[adb-protocols]: http://blogs.kgsoft.co.uk/2013_03_15_prg.htm

[file_sync_service.h]: https://github.com/android/platform_system_core/blob/master/adb/file_sync_service.h

[node-debug]: https://npmjs.org/package/debug

[net-connect]: http://nodejs.org/api/net.html#net_net_connect_options_connectionlistener

[node-events]: http://nodejs.org/api/events.html

[node-stream]: http://nodejs.org/api/stream.html

[node-buffer]: http://nodejs.org/api/buffer.html

[node-net]: http://nodejs.org/api/net.html

[node-fs]: http://nodejs.org/api/fs.html

[node-fs-stats]: http://nodejs.org/api/fs.html#fs_class_fs_stats

[adbkit-logcat]: https://npmjs.org/package/@u4/adbkit-logcat

[adbkit-monkey]: https://npmjs.org/package/@u4/adbkit-monkey

### Tests

Run `npm test` for the offline unit suite. Run `npm run test:device` with at least one Android device connected and authorized through the native `adb` server for the sync tests, and `npm run test:network` to check live scrcpy downloads. These live tests are excluded from the default test and coverage scripts.
