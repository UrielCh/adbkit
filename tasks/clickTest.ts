import adb, { DeviceClient, Utils, MotionEventMap, Scrcpy } from "../src/index.js";
import Parser from "../src/adb/parser.js";

const NB_CLICK = 1000000;

const Y_OFFSET = 0.02;//25;

async function* getCenterTaps(width: number, height: number, count: number, asPercent = false) {
  const centerX = asPercent ? width / 2 : Math.floor(width / 2);
  const centerY = asPercent ? height / 2 - height * Y_OFFSET : Math.floor(height / 2 - height * Y_OFFSET); // Move up by 20%
  const radius = Math.min(width, height) * 0.15; // 40% diameter = 20% radius

  console.log(`Screen: ${width}x${height}, Center: ${centerX},${centerY}, Circle radius: ${radius}`);
  const STEPS = 16;
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * (i % STEPS)) / STEPS;
    const x = asPercent ? centerX + radius * Math.cos(angle) : Math.floor(centerX + radius * Math.cos(angle));
    const y = asPercent ? centerY + radius * Math.sin(angle) : Math.floor(centerY + radius * Math.sin(angle));
    yield { x, y };
    // await Utils.delay(100);
  }
}


async function* getGridPercent(count: number) {
  const XGap = 0.02;
  const YGap = 0.35;
  const deltaX = 0.07;
  const deltaY = 0.07;
  let x = XGap;
  let y = YGap;
  for (let i = 0; i < count; i++) {
    x += deltaX;
    if (x > 1 - XGap) {
      x = XGap;
      y += deltaY;
      if (y > 1 - YGap) {
        y = YGap;
      }
    }
    yield { x, y };
    // await Utils.delay(100);
  }
}



async function* getCenterTapsForDevice(deviceClient: DeviceClient, count: number, asPercent = false) {
  if (asPercent) {
    // Use normalized coordinates (0-1) without retrieving actual screen size
    for await (const pos of getCenterTaps(1, 1, count, true)) {
      yield pos;
    }
  } else {
    const screenInfo = await deviceClient.execOut("wm size", "utf8");
    const match = screenInfo.match(/Physical size: (\d+)x(\d+)/);
    if (!match) {
      throw new Error("Could not parse screen dimensions");
    }
    const width = parseInt(match[1]);
    const height = parseInt(match[2]);
    for await (const pos of getCenterTaps(width, height, count, false)) {
      yield pos;
    }
  }
}

// async function* getFixedCenterForDevice(deviceClient: DeviceClient, count: number) {
//   const screenInfo = await deviceClient.execOut("wm size", "utf8");
//   const match = screenInfo.match(/Physical size: (\d+)x(\d+)/);
//   if (!match) {
//     throw new Error("Could not parse screen dimensions");
//   }
//   const width = parseInt(match[1]);
//   const height = parseInt(match[2]);
//   const centerX = Math.floor(width / 2);
//   const centerY = Math.floor(height / 2 - height * Y_OFFSET); // Move up by 20%
//   // const centerY = Math.floor(height / 2);
// 
//   console.log(`Screen: ${width}x${height}, Fixed center: ${centerX},${centerY}`);
// 
//   for (let i = 0; i < count; i++) {
//     yield { x: centerX, y: centerY };
//   }
// }

const testClickExec = async (deviceClient: DeviceClient) => {
  try {
    for await (const pos of getCenterTapsForDevice(deviceClient, NB_CLICK)) {
      await deviceClient.execOut(`input tap ${pos.x} ${pos.y}`, "utf8");
    }
  } catch (e) {
    console.error("Impossible to start", e);
  }
};

const testClickShell = async (deviceClient: DeviceClient, coordinateGenerator: AsyncGenerator<{ x: number, y: number }>) => {
  try {
    while (true) {
      const result1 = await coordinateGenerator.next();
      if (result1.done) break;

      const result2 = await coordinateGenerator.next();
      if (result2.done) break;

      const pos1 = result1.value;
      const pos2 = result2.value;

      // const duplex = await deviceClient.shell(`input multitap 2 ${pos1.x} ${pos1.y} ${pos2.x} ${pos2.y}`);
      const duplex = await deviceClient.shell(`input tap ${pos1.x} ${pos1.y}`);
      await new Parser(duplex).readAll();
    }
    console.log("All shell taps completed");
  } catch (e) {
    console.error("Shell command failed", e);
  }
};

const testClickScrcpy = async (deviceClient: DeviceClient, coordinateGenerator: AsyncGenerator<{ x: number, y: number }>) => {
  let scrcpy: Scrcpy | undefined;
  try {
    while (!scrcpy) {
      try {
        scrcpy = deviceClient.scrcpy({});
        await Utils.delay(1);
        await scrcpy.start();
        await scrcpy.width;
      } catch (e) {
        console.error('Scrcpy start failed, retrying...', e);
        await Utils.delay(1000);
        scrcpy = undefined;
      }
    }
    // const scrcpy
    // = deviceClient.scrcpy({});
    // await Utils.delay(1);
    // await scrcpy.start();
    await Utils.delay(1);
    const width = await scrcpy.width;
    const height = await scrcpy.height;
    const screenSize = { x: width, y: height };
    console.log('Scrcpy started');

    // Get screen dimensions
    // const screenInfo = await deviceClient.execOut("wm size", "utf8");
    // const match = screenInfo.match(/Physical size: (\d+)x(\d+)/);
    // if (!match) {
    //   throw new Error("Could not parse screen dimensions");
    // }
    // const screenSize = { x: parseInt(match[1]), y: parseInt(match[1]) };

    for await (const tap of coordinateGenerator) {
      // Convert percentage coordinates (0-1) to absolute pixels if needed
      const position = {
        x: tap.x <= 1 ? Math.floor(tap.x * width) : tap.x,
        y: tap.y <= 1 ? Math.floor(tap.y * height) : tap.y
      };
      // Send ACTION_DOWN followed by ACTION_UP for each tap
      // MotionEvent.ACTION_DOWN
      await scrcpy.injectTouchEvent(MotionEventMap.ACTION_DOWN, 0n, position, screenSize, undefined, 0, MotionEventMap.BUTTON_PRIMARY);
      await Utils.delay(8);
      //await scrcpy.injectTouchEvent(MotionEventMap.ACTION_UP, 0n, position, screenSize, undefined, 0, 0);
      //await Utils.delay(1);
    }
    console.log('All scrcpy taps completed');
  } catch (e) {
    console.error('Scrcpy command failed', e);
  } finally {
  }
  if (scrcpy)
    scrcpy.stop();
};


const main = async () => {
  // process.env.DEBUG = '*';
  const adbClient = adb.createClient();
  const devices = await adbClient.listDevices();
  if (!devices.length) {
    console.error("Need at least one connected android device");
    return;
  }
  const deviceClient = devices[0].getClient();

  // {
  //   let t1 = Date.now();
  //   await testClickExec(deviceClient);
  //   t1 = Date.now() - t1;
  //   console.log(`execOut = ${t1 / NB_CLICK}`); // 50.146 ms
  // }
  //
  if (false) {
    const promises: Promise<unknown>[] = [];
    let t2 = Date.now();
    promises.push(testClickShell(deviceClient, getCenterTapsForDevice(deviceClient, NB_CLICK)));
    //promises.push(testClickShell(deviceClient, getFixedCenterForDevice(deviceClient, NB_CLICK));
    await Promise.all(promises);
    t2 = Date.now() - t2;
    console.log(`shell = ${t2 / NB_CLICK}`); // 44.815 ms
  }

  if (true) {
    let t3 = Date.now();
    // await testClickScrcpy(deviceClient, getCenterTapsForDevice(deviceClient, NB_CLICK, true));
    await testClickScrcpy(deviceClient, getGridPercent(NB_CLICK));
    t3 = Date.now() - t3;
    console.log(`scrcpy = ${t3 / NB_CLICK}`);
  }

  console.log(`Done`);
};

process.on("unhandledRejection", (reason, promise) => {
  debugger;
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on(
  "exit",
  (code) => console.log("Processus is closing, exit code:", code),
);
process.on("SIGINT", () => console.log("SIGINT reçu"));
process.on("SIGTERM", () => console.log("SIGTERM reçu"));

main().catch((e) => console.error("ERROR", e)).finally(() => {
  console.log("Processus terminé");
});
