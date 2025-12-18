import adb, { DeviceClient, Utils, MotionEventMap, Scrcpy } from "../src/index.js";
import Parser from "../src/adb/parser.js";
import readline from "node:readline";

const NB_CLICK = 100000000;

const Y_OFFSET = 0.02;//25;

interface TapOptions {
  xRadius?: number;
  yRadius?: number;
  asPercent?: boolean;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  stepX?: number;
  stepY?: number;
}

const MODES = ["NONE", "CENTER", "MIX", "ALL", ] as const;
let MODE: (typeof MODES)[number] = "NONE";
let currentModeIndex = 0;
MODE = MODES[currentModeIndex];

async function* getCenterTaps(width: number, height: number, options: TapOptions = {}) {
  const { xRadius, yRadius, asPercent = false } = options;
  const centerX = asPercent ? width / 2 : Math.floor(width / 2);
  const centerY = asPercent ? height / 2 - height * Y_OFFSET : Math.floor(height / 2 - height * Y_OFFSET); // Move up by 20%
  const defaultRadius = Math.min(width, height) * 0.22; // 40% diameter = 20% radius
  const radiusX = xRadius ?? defaultRadius;
  const radiusY = yRadius ?? defaultRadius;

  console.log(`Screen: ${width}x${height}, Center: ${centerX},${centerY}, Radius: ${radiusX}x${radiusY}`);
  const STEPS = 16;

  const fromX = options.fromX ?? 0.1;
  const fromY = options.fromY ?? 0.1;

  const toX = options.toX ?? 0.9;
  const toY = options.toY ?? 0.9;

  const selctionsCenter: Array<{ x: number, y: number }> = [];
  const selctionsMix: Array<{ x: number, y: number }> = [];
  const selctionsAll: Array<{ x: number, y: number }> = [];

  const shuffle = (array: Array<{ x: number, y: number }>) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  };

  // while (true) 
  {
    for (let i = 0; i < (STEPS * 1); i++) {
      const angle = (2 * Math.PI * (i % STEPS)) / STEPS;
      const x = asPercent ? centerX + radiusX * Math.cos(angle) : Math.floor(centerX + radiusX * Math.cos(angle));
      const y = asPercent ? centerY + radiusY * Math.sin(angle) : Math.floor(centerY + radiusY * Math.sin(angle));
      selctionsCenter.push({ x, y });
      // yield { x, y };
      // await Utils.delay(100);
    }
    for (let x = fromX; x <= toX; x += (options.stepX ?? 0.1)) {
      for (let y = fromY; y <= toY; y += (options.stepY ?? 0.1)) {
        const posX = asPercent ? x : Math.floor(x * width);
        const posY = asPercent ? y : Math.floor(y * height);
        if (posX < 0.4 && posY < 0.4) continue;
        selctionsAll.push({ x: posX, y: posY });
        // yield { x: posX, y: posY };
        // await Utils.delay(100);
      }
    }
    selctionsMix.push(...selctionsCenter);
    selctionsMix.push(...selctionsCenter);
    selctionsMix.push(...selctionsCenter);
    selctionsMix.push(...selctionsCenter);
    selctionsMix.push(...selctionsAll);
    shuffle(selctionsCenter);
    shuffle(selctionsAll);
    shuffle(selctionsMix);
    
    while (true) {
      // console.log("Mode: ", MODE);
      await Utils.delay(100);
      if (MODE === "CENTER") {
        for (const selection of selctionsCenter) {
          await Utils.delay(1);
          yield selection;
          if (MODE !== "CENTER") {
            break;
          }
        }
      } else if (MODE === "MIX") {
        await Utils.delay(300);
        for (const selection of selctionsMix) {
          await Utils.delay(1);
          yield selection;
          if (MODE !== "MIX") {
            break;
          }
        }
      } else if (MODE === "ALL") {
        await Utils.delay(400);
        for (const selection of selctionsAll) {
          await Utils.delay(1);
          yield selection;
          if (MODE !== "ALL") {
            break;
          }
        }
      } else {
        await Utils.delay(200);
      }
    }
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



async function* getCenterTapsForDevice(deviceClient: DeviceClient, options: TapOptions = {}) {
  const { asPercent = false } = options;
  if (asPercent) {
    // Use normalized coordinates (0-1) without retrieving actual screen size
    for await (const pos of getCenterTaps(1, 1, options)) {
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
    for await (const pos of getCenterTaps(width, height, options)) {
      yield pos;
    }
  }
}

const testClickExec = async (deviceClient: DeviceClient) => {
  try {
    for await (const pos of getCenterTapsForDevice(deviceClient)) {
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
        await Utils.delay(2);
        await scrcpy.start();
        await scrcpy.width;
      } catch (e) {
        console.error('Scrcpy start failed, retrying...', e);
        await Utils.delay(1000);
        scrcpy = undefined;
      }
    }
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
      // const c2 = await coordinateGenerator.next();
      // if (!c2.done) {
      //   const tap2 = c2.value;
      //   const position2 = {
      //     x: tap2.x <= 1 ? Math.floor(tap2.x * width) : tap2.x,
      //     y: tap2.y <= 1 ? Math.floor(tap2.y * height) : tap2.y
      //   };
      //   await scrcpy.injectTouchEvent(MotionEventMap.ACTION_DOWN, 0n, position, screenSize, undefined, 0, MotionEventMap.BUTTON_SECONDARY);
      //   await scrcpy.injectTouchEvent(MotionEventMap.ACTION_UP, 0n, position, screenSize, undefined, 0, MotionEventMap.BUTTON_SECONDARY);
      // }
      await scrcpy.injectTouchEvent(MotionEventMap.ACTION_UP, 0n, position, screenSize, undefined, 0, 0);
      // await Utils.delay(1);
    }
    console.log('All scrcpy taps completed');
  } catch (e) {
    console.error('Scrcpy command failed', e);
  } finally {
  }
  if (scrcpy)
    scrcpy.stop();
};

const setupKeyboardInterface = () => {
  console.log('\n=== MODE CONTROL ===');
  console.log('Use ARROW KEYS (←/→) or SPACE to change mode');
  console.log('Press ESC or Ctrl+C to continue');
  console.log(`Current mode: ${MODE}`);
  
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  const keyListener = (_chunk: any, key: any) => {
    if (key) {
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('keypress', keyListener);
        console.log('\nContinuing with execution...\n');
        return;
      }
      
      if (key.name === 'left' || key.name === 'right' || key.name === 'space') {
        if (key.name === 'left') {
          currentModeIndex = (currentModeIndex - 1 + MODES.length) % MODES.length;
        } else {
          currentModeIndex = (currentModeIndex + 1) % MODES.length;
        }
        MODE = MODES[currentModeIndex];
        let line = `\rCurrent mode`;
        for (const m of MODES) {
          if (m === MODE) {
            line += ` [${m}]`;
          } else {
            line += `  ${m} `;
          }
        }
        process.stdout.write(line + '   ');
        //
        //process.stdout.write(`\rCurrent mode: ${MODE}   `);
      }
    }
  };

  process.stdin.on('keypress', keyListener);
  
  return new Promise<void>((resolve) => {
    const originalListener = process.stdin.listeners('keypress').find(l => l === keyListener);
    if (originalListener) {
      const wrappedListener = (_chunk: any, key: any) => {
        keyListener(_chunk, key);
        if (key && (key.name === 'escape' || (key.ctrl && key.name === 'c'))) {
          resolve();
        }
      };
      process.stdin.removeListener('keypress', keyListener);
      process.stdin.on('keypress', wrappedListener);
    }
  });
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
  // await 
  setupKeyboardInterface();
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
    promises.push(testClickShell(deviceClient, getCenterTapsForDevice(deviceClient)));
    //promises.push(testClickShell(deviceClient, getFixedCenterForDevice(deviceClient, NB_CLICK));
    await Promise.all(promises);
    t2 = Date.now() - t2;
    console.log(`shell = ${t2 / NB_CLICK}`); // 44.815 ms
  }

  if (true) {
    let t3 = Date.now();
    const opts = {
      asPercent: true,
      xRadius: 0.30,
      yRadius: 0.14,
      fromX: 0.08,
      fromY: 0.2,
      toX: 0.92,
      toY: 0.75,// 0.75,
      stepX: 0.05,
      stepY: 0.025,
    } satisfies TapOptions;
    opts.xRadius *= 0.8;
    opts.yRadius *= 0.8;
    await testClickScrcpy(deviceClient, getCenterTapsForDevice(deviceClient, opts));
    // await testClickScrcpy(deviceClient, getGridPercent(NB_CLICK));
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
process.on("SIGINT", () => {
  console.log("SIGINT reçu");
  process.exit();
});
process.on("SIGTERM", () => console.log("SIGTERM reçu"));

main().catch((e) => console.error("ERROR", e)).finally(() => {
  console.log("Processus terminé");
});
