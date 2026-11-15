import DeviceClient from "./DeviceClient.js";
import xpath from 'xpath';
import { DOMParser } from '@xmldom/xmldom';
import { KeyCodesMap, type KeyCodes } from "./keycode.js";
import Utils from './utils.js';

export default class DeviceClientExtra {
  constructor(private deviceClient: DeviceClient) { }
  /**
   * rootless version of enable usb tethering
   * Depends of phone language will fail with non latin language.
   * @param enable
   */
  async usbTethering(enable: boolean): Promise<boolean> {
    await this.keyCode(KeyCodesMap.KEYCODE_WAKEUP);
    await this.deviceClient.startActivity({ component: 'com.android.settings/.TetherSettings', wait: true });
    const xml = (await this.deviceClient.execOut('uiautomator dump /dev/tty', 'utf8')).replace(/UI hierchary dumped to: \/dev\/tty/g, '');
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    // https://gist.github.com/LeCoupa/8c305ec8c713aad07b14
    const nodesRaw = xpath.select('//*[contains(@text,"USB")]/../..', doc as unknown as Node);
    const nodes = Array.isArray(nodesRaw)
      ? nodesRaw.filter((n): n is Element => n.nodeType === 1)
      : [];
    if (!nodes.length)
      throw Error('can not find USB labeled node');
    const switch_widget = xpath.select('./*/node[@class="android.widget.Switch"]', nodes[0]) as unknown as Element[];
    if (!Array.isArray(switch_widget)) {
      throw Error('no switch on screen.');
    }
    if (!switch_widget.length)
      throw Error('can not find android.widget.Switch linked to USB label');
    const [checkBox] = switch_widget;
    // console.log(checkBox.toString());
    const checked = checkBox.getAttribute('checked') === 'true';
    const bounds = checkBox.getAttribute('bounds');
    if (!bounds)
      throw Error('missing bounds attribut to checkbox');
    if (checked === enable) {
      return false;
    }
    const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
    if (!m)
      throw Error('failed to parse Switch bounds');
    const [, x1, y1, x2, y2] = m.map(Number);
    await this.deviceClient.exec(['input', 'tap', Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)]);
    return true;
  }

  /**
   * Rootless version of enabling or disabling airplane mode.
   * @param enable expected final state for airplane mode
   * @param twiceMs if > 0 will switch airplane mode 2 times to match expected state
   */
  async airplaneMode(enable: boolean, twiceMs?: number): Promise<boolean> {
    // wake screen
    await this.keyCode(KeyCodesMap.KEYCODE_WAKEUP);
    await this.deviceClient.startActivity({ action: 'android.settings.AIRPLANE_MODE_SETTINGS', wait: true });
    // await Utils.delay(100);
    let xml = await this.deviceClient.execOut('uiautomator dump /dev/tty', 'utf8');
    xml = xml.replace('UI hierchary dumped to: /dev/tty', '');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const switches = xpath.select('//node[@class="android.widget.Switch"]', doc as unknown as Node) as Element[];
    if (!Array.isArray(switches) || !switches.length) throw Error('no switch on screen.');
    // The dedicated settings screen normally contains a single switch. If there
    // are several, only choose one with a recognizable airplane resource ID.
    const identified = switches.filter(node => /airplane|aeroplane/i.test(node.getAttribute('resource-id') ?? ''));
    const theSwitch = identified.length === 1 ? identified[0] : switches.length === 1 ? switches[0] : undefined;
    if (!theSwitch) throw Error('cannot uniquely identify the airplane mode switch');
    const checked = theSwitch.getAttribute('checked') === 'true';
    const bounds = theSwitch.getAttribute('bounds');
    if (!bounds)
      throw Error('missing bounds attribute in switch');
    if (!twiceMs && checked === enable) {
      return false;
    }
    const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
    if (!m)
      throw Error('failed to parse Switch bounds airplaneMode switch failed');
    const [, x1, y1, x2, y2] = m.map(Number);
    const x = Math.floor((x1 + x2) / 2);
    const y = Math.floor((y1 + y2) / 2);
    await this.tap(x, y);
    if (twiceMs && checked === enable) {
      await Utils.delay(twiceMs);
      await this.tap(x, y);
    }
    return true;
  }

  /**
   * @deprecated Use {@link airplaneMode} instead.
   */
  async airPlainMode(enable: boolean, twiceMs?: number): Promise<boolean> {
    return this.airplaneMode(enable, twiceMs);
  }

  /**
   * enable / disable 
   * type: bluetooth / data/ wifi
   */
  async setSvc(type: 'bluetooth' | 'data' | 'wifi', enable: boolean): Promise<string> {
    const action = enable ? 'enable' : 'disable';
    return this.deviceClient.execOut(['svc', type, action], 'utf8');
  }

  /**
   * Tap on screen
   * @param x1 
   * @param y1 
   * @returns 
   */
  async tap(x1: string | number, y1: string | number): Promise<string> {
    return this.deviceClient.execOut(['input', 'tap', x1, y1], 'utf8');
  }

  /**
   * Tap a keyCode
   * @param key
   * @returns 
   */
  async keyCode(key: KeyCodes): Promise<string> {
    return this.deviceClient.execOut(['input', 'keyevent', key], 'utf8');
  }

  /**
   * press the back button
   * @returns 
   */
  async back(): Promise<string> {
    return this.keyCode(KeyCodesMap.KEYCODE_BACK);
  }

}