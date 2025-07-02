# CHANGELOG

## V5.1.0 (2025-07-01)
* remove some dev depencences from depencences
* Allow authorization of known public keys in the tcp usb bridge [#540](https://github.com/DeviceFarmer/adbkit/pull/540)
* Add attach / detach commands [#534](https://github.com/DeviceFarmer/adbkit/pull/534)

## V5.0.0 (2025-07-01)
* migration to ESM
* Don't close connection after A_OPEN in tcp handling [#24](https://github.com/UrielCh/adbkit/issues/24)

## V4.1.19 (2023-05-23)
* update project shape
* https://github.com/UrielCh/adbkit/pull/14

## V4.1.18 (2023-02-06)
* update dependencies [fix issue 10](https://github.com/UrielCh/adbkit/issues/10)

## V4.1.17 (2022-11-08)
* fix typo in code

## V4.1.16 (2022-11-08)
* add `args` in interface StartServiceOptions can be a `string` or a `string[]`

## V4.1.15 (2022-11-08)
* add `args: string[]` in interface StartServiceOptions

## V4.1.14 (2022-11-04)
* rewrite legacy transfer function

## V4.1.13 (2022-11-04)
* improve file transfert

## V4.1.12 (2022-11-04)
* improve file transfert
* improve install APK

## v4.1.11 (2022-10-07)
* fix regression in Scrcpy [issue 9](https://github.com/UrielCh/adbkit/issues/9)

## v4.1.10 (2022-08-29)
* minicap-prebuilt for sdk 32+ removed from the package.

## v4.1.9 (2022-08-22)
* drop unused depencency
* dump dep versions
* improve STFService uninstall
  
## v4.1.8 (2022-08-15)
* improve disconnection detection in Minicap
* TSC Strict

## v4.1.7 (2022-08-14)
* fix Minicap failure after OS upgrade
* improve error messages

## v4.1.6 (2022-08-14)
* fix text detection on segmentented text in Utils.waitforText
* rename Util to Utils avoiding naming conflict.

## v4.1.5 (2022-08-09)
* add missing export
* fix airplan mode for android 12

## v4.1.4 (2022-08-06)
* bug fix im minicap launcher.
* add minicap for android 12.
* improve error messages.

## v4.1.3 (2022-07-27)
* refactor debug
* new debug messages
* add firstFrame promise to Minicap and Scrcpy
* improve Minicap and Scrcpy resiliance

## v4.1.2 (2022-07-27)
* minicap kill previous instance on startup
* minicap only upload its binary if thet are missing
* fix DeviceClient.tryForwardTCP failing with multiple devices

## v4.1.1 (2022-07-20)
* Imporve STFService to survive stress test

## v4.1.0 (2022-07-12)
* refactor Parser
* prefix all errors classes with Adb

## v4.0.4 (2022-07-11)
* improve Utils
* improve cli

## v4.0.3 (2022-07-01)
* fix plain mode

## v4.0.2 (2022-07-01)
* improve Documetation

## v4.0.1 (2022-07-01)
* new Documetation

## v4.0.0 (2022-06-30)
* new Documetation
* change connect() method, now return a boolean
* add DeviceClient.tryForwardTCP()

## v3.1.19 (2022-06-29)
* replace stat2 by stat64
* replace readdir2 by readdir64
* add DevicePackage
* replace getDHCPIpAddress(iface) => string by getIpAddress(iface) => string[]
* improve TS doc for StartServiceOptions
* dump deps versions

## v3.1.18 (2022-06-23)
* improve adbKit CLI

## v3.1.17 (2022-06-22)
* add deviceClient.stat2()
* add deviceClient.readdir2()
* improve adbKit CLI

## v3.1.16 (2022-06-22)
* add some extra function
* add abdkit functions
* fix french phone support

## v3.1.15 (2022-06-22)
* improve stream usage
* fix https://github.com/DeviceFarmer/adbkit/pull/302
* improve: https://github.com/compoundradius/adbkit/issues/1
* 
## v3.1.14 (2022-05-19)
* add scrcpy type export
* export add screm configurration in frame events

## v3.1.13 (2022-05-18)
* use scrcpy 1.24
* change scrcpy emited message

## v3.1.12 (2022-05-17)
* Fix https://github.com/DeviceFarmer/adbkit/issues/42
* improve Tracker on 'offline' and 'online' so they can be use as the 'add' and 'remove' event.

## v3.1.10 (2022-05-16)
* Tracker.on('add', listenner) always receves previous add events.

## v3.1.10 (2022-05-16)
* Improve parcel
* Rewrite Tracker avoiding stack leak
* add offline event in Tracker
* Improve typing

## v3.1.9 (2022-04-13)

* improve Error message buy adding context
* fix broken DeviceClient.install()

## v3.1.8 (2022-04-12)

* add disconnect event in third party modules.
* add isRunning() in third party modules.
* remove tunnelDelay from MiniCap option

## v3.1.7 (2022-04-07)

* thirdparty starts function retuns Promise<this>
* thirdparty starts function get resolved once fully initalized
* add host-serial:killforward command
* improve error messages
* add some exception catchs
* fix sudo command
* rewrite STFService connector, add noInstall flag

## v3.1.6 (2022-04-01)

* fix STFService localisation code
* fix STFService message parsing
* add STFService agent
* add STFService minitouchagent
* drop port fowarding from thirdparty apis
* expose STFService options

## v3.1.5 (2022-03-29)

* add DeviceClient.exec()
* add DeviceClient.execOut()
* add build-in minicap, relating on @devicefarmer/minicap-prebuilt depencency, see DeviceClient.minicap()
* add build-in STFService see DeviceClient.STFService()
* export Scrcpy const enums

## v3.1.4 (2022-03-24)

* fix scrcpy-server jar location
* refactor dist folder
* foward scrcpyServer error to emit('error')

## v3.1.3 (2022-03-24)

* fix scrcpy-server ControlMessages
* Improve ProcStat typing (add events)
* add parameter to reboot command

## v3.1.2 (2022-03-07)

* upgrade scrcpy-server to V 1.20
* add scrcpy controller commandes, see DeviceClient.scrcpy()

## v3.1.1 (2022-03-07)

* fix error in package.json dependences

## v3.1.0 (2022-03-02)

* add ip route command
* add ip rule command
* add scrcpy from [node-scrcpy-client](https://github.com/jvictorsoto/node-scrcpy-client) directly in DeviceClient
* fix event registration leaks.
* add waitForEnd() in transfert Object.
* add sudo flag in command
* DeviceClient can be obtain from a Device object using getClient()
* drop all bluebird references, use only native Promise.
* bump all depencences
* replace @devicefarmer/adbkit-monkey by @u4/adbkit-monkey
* replace @devicefarmer/adbkit-logcat by @u4/adbkit-logcat
* lint codebase
* sync 2 changes from @devicefarmer/adbkit

## v3.0.3 (2021-04-22)

* add `service` functions (list, check and call) will be improve in next versions.

## v3.0.2 (2021-04-06)

* add `ps` function.

## v3.0.1 (2021-02-17)

* add Utils in exports.

## v3.0.0 (2021-02-01)

* forked first release
