# Adb

## API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

### AdbSyncStatErrorCode

[src/adb/Sync.ts:30-52](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L30-L52 "Source code on GitHub")

error code from STA2

### IEmissions

[src/adb/Sync.ts:57-59](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L57-L59 "Source code on GitHub")

enforce EventEmitter typing

### stat

[src/adb/Sync.ts:92-112](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L92-L112 "Source code on GitHub")

Retrieves information about the given path.

#### Parameters

*   `path` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** The path.

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<Stats>** An \[`fs.Stats`]\[node-fs-stats] instance. While the `stats.is*` methods are available, only the following properties are supported:*   **mode** The raw mode.
*   **size** The file size.
*   **mtime** The time of last modification as a `Date`.

### readdir

[src/adb/Sync.ts:154-183](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L154-L183 "Source code on GitHub")

Retrieves a list of directory entries (e.g. files) in the given path, not including the `.` and `..` entries, just like \[`fs.readdir`]\[node-fs]. If given a non-directory path, no entries are returned.

#### Parameters

*   `path` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** The path.

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)<[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)\<Entry>>** An `Array` of \[`fs.Stats`]\[node-fs-stats]-compatible instances. While the `stats.is*` methods are available, only the following properties are supported (in addition to the `name` field which contains the filename):*   **name** The filename.
*   **mode** The raw mode.
*   **size** The file size.
*   **mtime** The time of last modification as a `Date`.

### push

[src/adb/Sync.ts:232-238](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L232-L238 "Source code on GitHub")

Attempts to identify `contents` and calls the appropriate `push*` method for it.

#### Parameters

*   `contents` **([string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String) | Readable)** When `String`, treated as a local file path and forwarded to `sync.pushFile()`. Otherwise, treated as a \[`Stream`]\[node-stream] and forwarded to `sync.pushStream()`.
*   `path` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** The path to push to.
*   `mode` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?** Optional. The mode of the file. Defaults to `0644`.

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<PushTransfer>** A `PushTransfer` instance. See below for details.

### pushFile

[src/adb/Sync.ts:247-250](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L247-L250 "Source code on GitHub")

Pushes a local file to the given path. Note that the path must be writable by the ADB user (usually `shell`). When in doubt, use `'/data/local/tmp'` with an appropriate filename.

#### Parameters

*   `file` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** The local file path.
*   `path` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** See `sync.push()` for details.
*   `mode`  See `sync.push()` for details. (optional, default `DEFAULT_CHMOD`)

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<PushTransfer>** See `sync.push()` for details.

### pushStream

[src/adb/Sync.ts:260-264](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L260-L264 "Source code on GitHub")

Pushes a \[`Stream`]\[node-stream] to the given path. Note that the path must be writable by the ADB user (usually `shell`). When in doubt, use `'/data/local/tmp'` with an appropriate filename.

#### Parameters

*   `stream` **Readable** The readable stream.
*   `path` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** See `sync.push()` for details.
*   `mode`  See `sync.push()` for details. (optional, default `DEFAULT_CHMOD`)

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<PushTransfer>** See `sync.push()` for details.

### pull

[src/adb/Sync.ts:271-274](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L271-L274 "Source code on GitHub")

Pulls a file from the device as a `PullTransfer` \[`Stream`]\[node-stream].

#### Parameters

*   `path` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** The path to pull from.

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<PullTransfer>** A `PullTransfer` instance. See below for details.

### end

[src/adb/Sync.ts:280-283](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L280-L283 "Source code on GitHub")

Closes the Sync connection, allowing Node to quit (assuming nothing else is keeping it alive, of course).

Returns **Sync** Returns: The sync instance.

### tempFile

[src/adb/Sync.ts:291-293](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L291-L293 "Source code on GitHub")

A simple helper method for creating appropriate temporary filenames for pushing files. This is essentially the same as taking the basename of the file and appending it to `'/data/local/tmp/'`.

#### Parameters

*   `path` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** The path of the file.

Returns **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** An appropriate temporary file path.

### temp

[src/adb/Sync.ts:70-72](https://github.com/UrielCh/adbkit/blob/3098b75fc9cef48aa8c63a441fa79a4ff1f796eb/src/adb/Sync.ts#L70-L72 "Source code on GitHub")

get a temp file path

#### Parameters

*   `path` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** filename

Returns **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** full path on android devices