/* eslint-disable @typescript-eslint/no-unused-vars */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { assert } from 'node:console';

import pc from 'picocolors';

import adb, { DeviceClient, KeyCodesMap, Utils, MotionEventMap, Client, Minicap, Scrcpy, VideoStreamFramePacket } from '../src/index.js';
import { IpRouteEntry, IpRuleEntry } from '../src/adb/command/host-transport/index.js';
import Parser from '../src/adb/parser.js';
import { KeyEventMap } from '../src/adb/thirdparty/STFService/STFServiceModel.js';
import ThirdUtils from '../src/adb/thirdparty/ThirdUtils.js';

// import './patchEventEmitter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// const logRunning = require('why-is-node-running');

function print(list: Array<IpRouteEntry | IpRuleEntry>) {
  for (const route of list) console.log(route.toString());
}

function fmtSize(trData: number): string {
  let str = '';
  if (trData > 1024 * 1024) {
    str = (trData / (1024 * 1024)).toFixed(1) + 'MB';
  } else if (trData > 1024) {
    str = (trData / 1024).toFixed(1) + 'KB';
  } else {
    str = trData + 'B';
  }
  return str;
}

const testScrcpy = async (deviceClient: DeviceClient) => {
  const scrcpy = deviceClient.scrcpy({ version: '2.7' });
  scrcpy.on('error', (e) => {
    console.error('scrcpy error', e);
  });
  let nbFrame = 0;
  let nbkeyframe = 0;
  let nbPkg = 0;
  let trData = 0;
  const MAX_FRAMES = 200;
  const loginterval = setInterval(() => {
    if (!nbPkg)
      return;
    console.log(`${nbPkg} packet Transfered for a total of ${fmtSize(trData)}`);
    nbPkg = 0;
    trData = 0;
  }, 1000);
  // const mille: BigInt = 1000n;

  const onFrame: (data: VideoStreamFramePacket) => void = async ({ pts, data, keyframe, config }) => {
    nbPkg++;
    nbFrame++;
    if (keyframe)
      nbkeyframe++;
    trData += data.length;
    const asFloat = parseFloat((pts || 0).toString())
    const sec = asFloat / 1000000;
    console.log(`[${sec.toFixed(1)}] Data: ${fmtSize(data.length)} ${nbFrame} Frame receved ${nbkeyframe} KeyFrame`)
    if (nbFrame >= MAX_FRAMES) {
      console.log('capture Done config:', JSON.stringify(config));
      scrcpy.stop();
      // await deviceClient.disconnect();
      scrcpy.off('frame', onFrame);
      clearInterval(loginterval);
      // await Utils.delay(100);
      // logRunning();
    }
  }
  scrcpy.on('frame', onFrame);
  try {
    await scrcpy.start();
    console.log('scrcpy Started waiting for Termination');
    await scrcpy.onTermination;
  } catch (e) {
    console.error('Impossible to start', e);
  }
}

/**
 * Works with V2.7
 * @param deviceClient 
 */
const testScrcpyTextInput = async (deviceClient: DeviceClient) => {
  const scrcpy = deviceClient.scrcpy({});
  try {
    await scrcpy.start();
    console.log(`Started`);
    await Utils.delay(100);
    console.log(`delay ok`);
    await Utils.delay(100);
    await scrcpy.injectText('foo bar')
    await Utils.delay(100);
    await scrcpy.injectKeycodeEvent(MotionEventMap.ACTION_DOWN, KeyCodesMap.KEYCODE_D, 1, 0);
    await scrcpy.injectKeycodeEvent(MotionEventMap.ACTION_UP, KeyCodesMap.KEYCODE_D, 1, 0);
    await scrcpy.injectKeycodeEvent(MotionEventMap.ACTION_DOWN, KeyCodesMap.KEYCODE_D, 1, 0);
    await scrcpy.injectKeycodeEvent(MotionEventMap.ACTION_UP, KeyCodesMap.KEYCODE_D, 1, 0);
    await Utils.delay(1000);
    console.log(`stop`);
    scrcpy.stop();
    console.log(`done`);
  } catch (e) {
    console.error('Impossible to start', e);
  }
}

const testScrcpyswap = async (deviceClient: DeviceClient) => {
  // const scrcpy = deviceClient.scrcpy({port: 8099, maxFps: 1, maxSize: 320});
  const scrcpy = deviceClient.scrcpy({ maxFps: 1 });
  try {
    const pointerId = BigInt('0xFFFFFFFFFFFFFFFF');
    await scrcpy.start();
    console.log(`Started`);
    scrcpy.on("error", (e) => {
      console.error('scrcpy error', e);
    });
    scrcpy.on("config", (meta) => {
      console.log('scrcpy config', meta);
    });
    scrcpy.on("frame", (data) => {
      console.log(`scrcpy emit hit first frame isKeyframe: ${data.keyframe}`);
    });
    await Utils.delay(100);
    const width = await scrcpy.width;
    const height = await scrcpy.height;
    const position = { x: width / 2, y: height * 0.2 };
    const bottom = height * 0.8;
    const screenSize = { x: width, y: height }
    await scrcpy.injectTouchEvent(MotionEventMap.ACTION_DOWN, pointerId, position, screenSize, 0xFFFF);
    console.log('start position', position);
    while (position.y < bottom) {
      await Utils.delay(2);
      await scrcpy.injectTouchEvent(MotionEventMap.ACTION_MOVE, pointerId, position, screenSize, 0xFFFF);
      position.y += 5;
    }
    console.log('end position', position);
    await scrcpy.injectTouchEvent(MotionEventMap.ACTION_UP, pointerId, position, screenSize, 0x0000);
    await Utils.delay(1000);
    console.log(`done`);
  } catch (e) {
    console.error('scrcpy failed', e);
  } finally {
    scrcpy.stop();
  }
}

/** test the 2 ways to capture Error in atrcpy */
// encoderName had been replaced by list_encoders in V 2.0
const testScrcpyEncoder = async (deviceClient: DeviceClient) => {
  const scrcpy = deviceClient.scrcpy({ encoderName: '_' });
  try {
    let nbError = 0;
    scrcpy.on('error', (e) => { nbError++; console.error("scrcpy Error:", e) });
    // scrcpy.on('error', (e) => { nbError++; /* get Error message line per line */ });
    await scrcpy.start();
    const error = await scrcpy.onTermination;
    // full error message
    // console.log(error);
    const m = [...error.matchAll(/encoder '([^']+)'/g)].map(a => a[1]);
    console.log(`Available Encoder are: ${m.map(pc.yellow).join(', ')}`);
    // Available Encoder are: OMX.qcom.video.encoder.avc, c2.android.avc.encoder, OMX.google.h264.encoder
  } catch (e) {
    console.error('Unexpected exit:', (e as Error).message);
  } finally {
    scrcpy.stop();
  }
  await Utils.delay(1000);
  await scrcpy.onTermination;
}

const testMinicap = async (deviceClient: DeviceClient) => {
  // const scrcpy = deviceClient.scrcpy({port: 8099, maxFps: 1, maxSize: 320});
  const minicap = deviceClient.minicap({});
  try {
    await minicap.start();
    minicap.on('data', (buf: Buffer) => {
      console.log('rcv Buffer ', buf.length);
    })
    await Utils.delay(10000)
    console.log(`done`);
  } catch (e) {
    console.error('scrcpy failed', e);
  } finally {
    minicap.stop('user End');
  }
}

const stressMinicap = async (deviceClient: DeviceClient) => {
  // const scrcpy = deviceClient.scrcpy({port: 8099, maxFps: 1, maxSize: 320});
  const minicaps: Minicap[] = [];
  for (let i = 0; i < 15; i++) {
    const pass = i;
    const minicap = deviceClient.minicap({});
    await Utils.delay(100);
    minicaps.push(minicap)
    try {
      await minicap.start();
      minicap.on('data', (buf: Buffer) => {
        console.log(`rcv Buffer ${buf.length} from #${pass}`);
      })
    } catch (e) {
      console.error(`start minicap ${pass} failed`, e);
    }
  }
  // await Util.delay(1000);
  const closeing = minicaps.map(m => m.stop());
  console.log("closeing", closeing)
}

const stressTestScrCpy = async (deviceClient: DeviceClient) => {
  // const scrcpy = deviceClient.scrcpy({port: 8099, maxFps: 1, maxSize: 320});
  const scrcpys: Scrcpy[] = [];
  for (let i = 0; i < 15; i++) {
    const pass = i;
    const scrcpy = deviceClient.scrcpy({});
    await Utils.delay(100);
    scrcpys.push(scrcpy)
    try {
      scrcpy.on("error", (e) => {
        console.error(`scrcpy #${pass} error`, e);
      });
      scrcpy.once('frame', (data) => {
        console.log(`${pc.magenta('scrcpy')} emit hit first frame isKeyframe: ${data.keyframe} from #${pass}`);
      })
      scrcpy.once('error', (data) => {
        console.log(`${pc.red('scrcpy')} emit hit error: ${data} from #${pass}`);
      })
      await scrcpy.start();
      await scrcpy.firstFrame;
      console.log(`${pc.magenta('scrcpy')} Should had emit hit first frame isKeyframe from #${pass}`);
    } catch (e) {
      console.error(`Start Scrcpy PASS:${pass} failed ${(e as Error).message}`);
    }
  }
  // await Util.delay(1000);
  const closeing = scrcpys.map(m => m.stop());
  console.log("closing", closeing)
}


const testService = async (deviceClient: DeviceClient) => {
  //   String getDeviceId(String callingPackage);
  // const imei = await deviceClient.callServiceRaw('iphonesubinfo', 1);
  // console.log(imei.readType());
  // console.log('GET:', imei.readString());
  // console.log('Exp:', '861758051379536');
  let diasble = true;
  diasble = false;

  if (diasble) {
    const version = await deviceClient.callServiceRaw('iphonesubinfo', 6);
    console.log(version.readType());
    console.log('GET:', version.readString());
    console.log('Exp:', '24');
  }

  if (diasble) {
    const parcel = await deviceClient.callServiceRaw('iphonesubinfo', 8);
    console.log(parcel.readType());
    console.log('GET:', parcel.readString());
  }

  if (diasble) {
    const parcel = await deviceClient.callServiceRaw('iphonesubinfo', 12);
    console.log(parcel.readType());
    console.log('GET:', parcel.readString()); // 8933150319110286529
  }

  if (diasble) {
    // num de tel
    const parcel = await deviceClient.callServiceRaw('iphonesubinfo', 15);
    console.log(parcel.readType());
    console.log('GET:', parcel.readString()); // 8933150319110286529
  }

  if (diasble) {
    // GET: Attempt to invoke virtual method 'java.security.PublicKey android.telephony.ImsiEncryptionInfo.getPublicKey()' on a null object reference
    const parcel = await deviceClient.callServiceRaw('iphonesubinfo', 24);
    console.log(parcel.readType());
    console.log('GET:', parcel.readString()); // 8933150319110286529
  }
  if (diasble) {
    // GET: Attempt to invoke virtual method 'java.security.PublicKey android.telephony.ImsiEncryptionInfo.getPublicKey()' on a null object reference
    try {
      const parcel = await deviceClient.callServiceRaw('iphonesubinfo', 500);
      console.log(parcel.readType());
      console.log('GET:', parcel.readString()); // 8933150319110286529
    } catch (e) {
      console.log(e) // 8933150319110286529
    }
  }

  if (diasble) {
    // Attempt to invoke interface method 'void android.net.wifi.IOnWifiActivityEnergyInfoListener.onWifiActivityEnergyInfo(android.os.connectivity.WifiActivityEnergyInfo)' on a null object reference
    const parcel = await deviceClient.callServiceRaw('wifi', 2);
    console.log(parcel.readType());
    console.log('GET:', parcel.readString()); // 8933150319110286529
  }

  {
    // Attempt to invoke interface method 'void android.net.wifi.IOnWifiActivityEnergyInfoListener.onWifiActivityEnergyInfo(android.os.connectivity.WifiActivityEnergyInfo)' on a null object reference
    const parcel = await deviceClient.callServiceRaw('wifi', 3);
    console.log(parcel.readType());
    console.log('GET:', parcel.readString()); // 8933150319110286529
  }
}
// Available Encoder are: OMX.qcom.video.encoder.avc, c2.android.avc.encoder, OMX.google.h264.encoder

const extractFramesStream = async (deviceClient: DeviceClient, encoderName: 'OMX.qcom.video.encoder.avc' | 'c2.android.avc.encoder' | 'OMX.google.h264.encoder') => {
  const dest = path.join(__dirname, encoderName || 'capture');
  try {
    fs.mkdirSync(dest);
  } catch (e) {
    //ignore 
  }
  const scrcpy = deviceClient.scrcpy({ encoderName });
  const toCapture = 100;
  let captured = 0;

  let ext = 'raw';
  if (encoderName.includes('h264')) ext = 'h264';
  else if (encoderName.includes('avc')) ext = 'avc';
  scrcpy.on('config', (meta) => {
    console.log(meta);
  });

  scrcpy.on('frame', (data) => {
    captured++;
    const d = path.join(dest, `${captured.toString().padStart(3, '0')}.${ext}`);
    fs.writeFileSync(d, data.data)
    if (data.keyframe)
      console.log(`${d} is a Keyframe`)
    if (captured >= toCapture) {
      console.log(`${toCapture} frame captured. lat frame:${d}`)
      scrcpy.stop();
    }
  });
  await scrcpy.start();
  await scrcpy.onTermination;
}

const testSTFService = async (deviceClient: DeviceClient) => {
  // const scrcpy = deviceClient.scrcpy({port: 8099, maxFps: 1, maxSize: 320});
  const STFService = deviceClient.STFService({ timeout: 200000 });
  try {
    STFService.on("airplaneMode", (data) => console.log('airplaneMode', data));
    STFService.on("battery", (data) => console.log('battery', data));
    STFService.on("browerPackage", (data) => console.log('browerPackage', data));
    STFService.on("connectivity", (data) => console.log('connectivity', data));
    STFService.on("phoneState", (data) => console.log('phoneState', data));
    STFService.on("rotation", (data) => console.log('rotation', data));
    console.log('STFService.start');

    await STFService.start();

    // console.log(await STFService.getAccounts()); // Ok
    // console.log(await STFService.getBluetoothStatus()); // Ok
    // console.log(await STFService.getBrowsers()); // Ok
    // console.log(await STFService.getClipboard()); // Ok
    // console.log(await STFService.getDisplay()); // Ok
    // console.log(await STFService.getProperties([])); // Ok
    // console.log(await STFService.getRootStatus()); // Ok
    // console.log(await STFService.getSdStatus()); // Ok
    // console.log(await STFService.getWifiStatus()); // Ok

    // console.log(await STFService.setWifiEnabledRequest({enabled: false})); // no effect

    // console.log(await STFService.getRingerMode()); // Ok
    // console.log(await STFService.setRingerMode({mode: RingerMode.VIBRATE}));

    // 42["input.touchCommit","lltyo9nLCZaZdViaqnTeSMafku8=",{"seq":28}]
    // await Util.delay(1000);
    await STFService.doWake({});
    await STFService.doKeyEvent({ event: KeyEventMap.PRESS, keyCode: KeyCodesMap.KEYCODE_0 });
    await STFService.doKeyEvent({ event: KeyEventMap.PRESS, keyCode: KeyCodesMap.KEYCODE_0 });
    await STFService.doType({ text: 'test' });


    const { x: w, y: h } = await ThirdUtils.getScreenSize(deviceClient);
    // const dim = `${x}x${y}`;


    // const contact = 0;
    // const pressure = 0.5;
    // // not working
    let x = 0.4;
    const y = 0.3;
    await Utils.delay(1000);
    await STFService.downCommit(x * w, y * w);
    for (let i = 0; i < 20; i++) {
      x += 0.01
      await STFService.moveCommit(x * w, y * w);
    }
    await STFService.upCommit();

    console.log(`done`);
    await Utils.delay(1000);
    console.log(await STFService.getSdStatus()); // Ok
    console.log(await STFService.getWifiStatus()); // Ok
  } catch (e) {
    console.error('STFService failed', e);
  } finally {
    //minicap.stop();
  }
}

const testRouting = async (deviceClient: DeviceClient) => {
  deviceClient = deviceClient.sudo();
  const rules = await deviceClient.ipRule('list');
  const routes = await deviceClient.ipRoute('list', 'table', 'all');
  const routesWifi = await deviceClient.ipRoute('show table wlan0');
  const routes4G = await deviceClient.ipRoute('show table rmnet_data2');
  const defaultWifi = routesWifi.find(r => r.dest === 'default')
  const default4G = routes4G.find(r => r.dest === 'default')
  if (!defaultWifi) {
    throw Error('no wifi route');
  }
  if (!default4G) {
    throw Error('no 4g route');
  }

  console.log(`default Wifi is: ${defaultWifi}`);
  console.log(`default   4G is: ${default4G}`);
  // double rules
  // try {
  //   console.log(`ip route add ${defaultWifi.toString()} table wlan0`);
  //   await deviceClient.getIpRoute(`add ${defaultWifi.toString()} table wlan0`);
  // } catch (e) {
  //   if (e instanceof Error)
  //     console.log(e.message);
  // }
  await deviceClient.ipRoute(`del ${defaultWifi.toString()} table wlan0`);
  await deviceClient.ipRoute(`add ${default4G.toString()} table wlan0`);
  const toWifi = defaultWifi.clone()
  toWifi.dest = '212.129.20.0/24';
  await deviceClient.ipRoute(`add ${toWifi.toString()} table wlan0`);
  // rool back:
  // console.log(`rool back:`);
  // await deviceClient.ipRoute(`ip route add ${defaultWifi.toString()} table wlan0`);
  // await deviceClient.ipRoute(`ip route del ${default4G.toString()} table wlan0`);
  // await deviceClient.ipRoute(`ip route del ${toWifi.toString()} table wlan0`);
  //ip route add default via 10.38.199.10 dev rmnet_data2 proto static mtu 1500 table 1021
  //const transport = await deviceClient.transport();
  //const rules2 = await new IpRuleCommand(transport, {sudo: true}).execute('list');
  //for (const rule of rules2)
  //  console.log(rule.toStirng());
}
/**
 * 
 * @param deviceClient dump an XML file with the current UI
 */
const testUiautomator = async (deviceClient: DeviceClient) => {
  const duplex = await deviceClient.shell('uiautomator dump /dev/tty');
  const result = await new Parser(duplex).readAll();
  console.log(result.toString('utf8'));
}

const testTracker = async (adbClient: Client) => {
  const tracker = await adbClient.trackDevices()
  tracker.on('add', (device) => console.log('add Device ', device))
  tracker.on('remove', (device) => console.log('remove Device ', device))
  tracker.on('change', (device) => console.log('change Device ', device))
  tracker.on('offline', (device) => console.log('offline Device ', device))
  tracker.on('end', () => console.log('end Device'))
  tracker.end();
}

async function testBasic(deviceClient: DeviceClient) {
  const ips = await deviceClient.getIpAddress();
  assert(ips.length > 0, "No IP address found");
  // console.log(ips);
  let pkgs = await deviceClient.listPackages();
  pkgs = pkgs.filter(p => p.name.endsWith('.chrome'))
  assert(pkgs.length > 0, "No chrome package found");
  // if (pkgs.length) {
  //   console.log(`Pkg: ${pkgs[0].name}`);
  //   const info = await pkgs[0].getInfo();
  //   console.log(`versionName: ${info.versionName}`);
  //   console.log(`dataDir: ${info.dataDir}`);
  //   console.log(`primaryCpuAbi: ${info.primaryCpuAbi}`);
  //   console.log(`lastUpdateTime: ${info.lastUpdateTime}`);
  // }
  // await deviceClient.clear('com.android.chrome');

  const ret1 = await deviceClient.stat('/');
  assert((0o40000 & ret1.mode) === 0o40000, 'isDirectory');
  assert(ret1.isDirectory(), 'isDirectory');
  assert(ret1.size > 0, 'size');
  // console.log(ret1);
  const ret2 = await deviceClient.stat64('/system');
  assert((0o40000n & ret2.mode) === 0o40000n, 'isDirectory');
  assert(ret2.isDirectory(), 'isDirectory');
  assert(ret2.size > 0, 'size');

  // console.log(ret2.ctime);
  // console.log(ret2.isDirectory());

  const list = await deviceClient.readdir64('/');
  assert(list.length, 'can list /');
  // console.log(list.map(a=>a.toString()).join('\n'));
}

const main = async () => {
  // process.env.DEBUG = '*';
  const adbClient = adb.createClient();
  const devices = await adbClient.listDevices();

  if (!devices.length) {
    console.error('Need at least one connected android device');
    return;
  }

  const deviceClient = devices[0].getClient();

  // await testBasic(deviceClient);

  // await deviceClient.extra.usbTethering(true);
  // await deviceClient.extra.airPlainMode(false, 300);
  // await deviceClient.extra.airPlainMode(true);

  // await testScrcpyEncoder(deviceClient); // removed in V2.0
  // await testScrcpy(deviceClient);
  // await testUiautomator(deviceClient);
  // await testScrcpyTextInput(deviceClient);
  // await testScrcpyswap(deviceClient);
  //
  // await testMinicap(deviceClient);
  // await stressMinicap(deviceClient);

  // process.stdin.resume();
  // await stressTestScrCpy(deviceClient);

  // await testSTFService(deviceClient);
  // await testService(deviceClient);
  // await extractFramesStream(deviceClient, 'OMX.qcom.video.encoder.avc');
  // await extractFramesStream(deviceClient, 'c2.android.avc.encoder');
  // await extractFramesStream(deviceClient, 'OMX.google.h264.encoder');
  // const bug = await deviceClient.execOut('ls', 'utf8');
  // const bug = await deviceClient.execOut('wm size', 'utf8');
  // const duplex = new PromiseDuplex(await deviceClient.exec('ls'));
  // await protoTest();
  console.log('all Done');
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('exit', (code) => console.log('Processus is closing, exit code:', code));
process.on('SIGINT', () => console.log('SIGINT reçu'));
process.on('SIGTERM', () => console.log('SIGTERM reçu'));

main().catch(e => console.error("ERROR", e)).finally(() => {
  console.log('Processus terminé');
});