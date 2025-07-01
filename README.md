# adbkit

[![NPM Version](https://img.shields.io/npm/v/@u4/adbkit.svg?style=flat)](https://www.npmjs.org/package/@u4/adbkit)

**adbkit** is a pure [Node.js][nodejs] client for the [Android Debug Bridge][adb-site] server. It can be used either as a library in your own application, or simply as a convenient utility for playing with your device.

Most of the `adb` command line tool's functionality is supported (including pushing/pulling files, installing APKs and processing logs), with some added functionality such as being able to generate touch/key events and take screenshots. Some shims are provided for older devices, but we have not and will not test anything below Android 2.3.

Internally, we use this library to drive a multitude of Android devices from a variety of manufacturers, so we can say with a fairly high degree of confidence that it will most likely work with your device(s), too.

## Requirements

*   [Node.js][nodejs] >= 18
*   The `adb` command line tool

Please note that although it may happen at some point, **this project is NOT an implementation of the ADB *server***. The target host (where the devices are connected) must still have ADB installed and either already running (e.g. via `adb start-server`) or available in `$PATH`. An attempt will be made to start the server locally via the aforementioned command if the initial connection fails. This is the only case where we fall back to the `adb` binary.

When targeting a remote host, starting the server is entirely your responsibility.

Alternatively, you may want to consider using the Chrome [ADB][chrome-adb] extension, as it includes the ADB server and can be started/stopped quite easily.

For Linux users, adb need `plugdev` group acess, So you may need to add your current user to `plugdev` group.
`sudo usermod -a -G plugdev $USER`

## Getting started

Install via NPM:

```bash
npm install --save @u4/adbkit
```

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
  // print Hello Word in a shell and get the echo back
  const hello = await deviceClient.execOut('echo Hello Word', 'utf8');
  console.log(hello)
}
```

[full documentaion is available here](https://urielch.github.io/adbkit/)


## Incompatible changes in version 5.x

- the project only contains ESM modules

## Incompatible changes in version 3.x

- Previously, adbKit was based on Bluebird, It's now based on native Promise some Bluebird Promise cannelation is not compatible with ES6 Promises.
- v4 is Object oriented functions taking a serial as first parameter had been moved to DeviceClient

## More information

*   [Android Debug Bridge][adb-site]
   *   [SERVICES.TXT][adb-services] (ADB socket protocol)
*   [Android ADB Protocols][adb-protocols] (a blog post explaining the protocol)
*   [adb.js][adb-js] (another Node.js ADB implementation)
*   [ADB Chrome extension][chrome-adb]

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE](LICENSE).

[nodejs]: http://nodejs.org/

[npm]: https://npmjs.org/

[adb-js]: https://github.com/flier/adb.js

[adb-site]: http://developer.android.com/tools/help/adb.html

[adb-services]: https://github.com/android/platform_system_core/blob/master/adb/SERVICES.TXT

[adb-protocols]: http://blogs.kgsoft.co.uk/2013_03_15_prg.htm

[file_sync_service.h]: https://github.com/android/platform_system_core/blob/master/adb/file_sync_service.h

[chrome-adb]: https://chrome.google.com/webstore/detail/adb/dpngiggdglpdnjdoaefidgiigpemgage

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

[@yume-chan/adb](https://www.npmjs.com/package/@yume-chan/adb) a browser adb implementation
