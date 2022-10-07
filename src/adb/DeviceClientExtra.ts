import DeviceClient from "./DeviceClient";
import xpath from 'xpath';
import { DOMParser } from 'xmldom';
import { KeyCodes } from "./keycode";
import { Utils } from "..";

export default class DeviceClientExtra {
  constructor(private deviceClient: DeviceClient) { }
  /**
   * rootless version of enable usb tethering
   * Depends of phone language will fail with non latin language.
   * @param enable
   */
  async usbTethering(enable: boolean): Promise<boolean> {
    await this.keyCode(KeyCodes.KEYCODE_WAKEUP);
    await this.deviceClient.startActivity({ component: 'com.android.settings/.TetherSettings', wait: true });
    const xml = await this.deviceClient.execOut('uiautomator dump /dev/tty', 'utf8');
    const doc = new DOMParser().parseFromString(xml)
    // https://gist.github.com/LeCoupa/8c305ec8c713aad07b14
    const nodes = xpath.select('//*[contains(@text,"USB")]/../..', doc) as Element[];
    if (!nodes.length)
      throw Error('can not find USB labeled node');
    const switch_widget = xpath.select('./*/node[@class="android.widget.Switch"]', nodes[0]) as Element[];
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
    const [, x1, y1] = m; // , x2, y2
    await this.deviceClient.exec('input tap ' + x1 + ' ' + y1);
    return true;
  }

  /**
   * rootless version of enable air plain mode
   * Depends of phone language will fail with non latin language.
   * @param enable expected final stat for airplain mode
   * @param twiceMs if > 0 will switch airplan mode 2 time to match expected state
   */
  async airPlainMode(enable: boolean, twiceMs?: number): Promise<boolean> {
    // wake screen
    await this.keyCode(KeyCodes.KEYCODE_WAKEUP);
    await this.deviceClient.startActivity({ action: 'android.settings.AIRPLANE_MODE_SETTINGS', wait: true });
    // await Utils.delay(100);
    let xml = await this.deviceClient.execOut('uiautomator dump /dev/tty', 'utf8');
    xml = xml.replace('UI hierchary dumped to: /dev/tty', '');
    // xml = xml.replace(/ ([a-z-]+)=""/g, '');
    // xml = xml.replace(/ (checkable|clickable|content-desc|enabled|focused|focusable|index|long-clickable|package|password|resource-id|scrollable|selected)="[^"]*"/g, '');
    const textFilter = (text: string) => text.toLowerCase();
    const doc = new DOMParser().parseFromString(textFilter(xml))

    const all_switch_widget = xpath.select(textFilter('//*/node[@class="android.widget.Switch"]'), doc) as Element[];
    let theSwitch: Element | null = null;
    if (!all_switch_widget.length) {
      throw Error('no switch on screen.');
    }
    for (let i = 0; i < all_switch_widget.length; i++) {
      const nodes = xpath.select('../../*/node[contains(@text,"mode")]', all_switch_widget[i]) as Element[];
      if (nodes.length) {
        theSwitch = all_switch_widget[i];
      }
    }
    if (!theSwitch) {
      throw Error('can not find mode labeled node "mode avion" airPlainMode switch failed');
    }
    // https://gist.github.com/LeCoupa/8c305ec8c713aad07b14
    // "Airplane mode"
    const checked = theSwitch.getAttribute('checked') === 'true';
    const bounds = theSwitch.getAttribute('bounds');
    if (!bounds)
      throw Error('missing bounds attribut in switch');
    if (!twiceMs && checked === enable) {
      return false;
    }
    const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
    if (!m)
      throw Error('failed to parse Switch bounds airPlainMode switch failed');
    const [, x1, y1] = m; // , x2, y2
    await this.tap(x1, y1);
    if (twiceMs && checked === enable) {
      await Utils.delay(twiceMs);
      await this.tap(x1, y1);
    }
    return true;
  }

  /**
   * enable / disable 
   * type: bluetooth / data/ wifi
   */
  async setSvc(type: 'bluetooth' | 'data' | 'wifi', enable: boolean): Promise<string> {
    const action = enable ? 'enable' : 'disable';
    return this.deviceClient.execOut(`svc ${type} ${action}`, 'utf8');
  }

  /**
   * Tap on screen
   * @param x1 
   * @param y1 
   * @returns 
   */
  async tap(x1: string, y1: string): Promise<string> {
    return this.deviceClient.execOut(`input tap ${x1} ${y1}`, 'utf8');
  }

  /**
   * Tap a keyCode
   * @param x1 
   * @param y1 
   * @returns 
   */
  async keyCode(key: KeyCodes): Promise<string> {
    return this.deviceClient.execOut(`input keyevent ${key}`, 'utf8');
  }

  /**
   * press the back button
   * @returns 
   */
  async back(): Promise<string> {
    return this.keyCode(KeyCodes.KEYCODE_BACK);
  }

}