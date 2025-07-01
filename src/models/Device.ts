import DeviceClient from "../adb/DeviceClient.js";

const deviceTypes = ['emulator', 'device', 'offline', 'unauthorized', 'recovery'] as const;
/**
 * adb device starts
 */
export type DeviceType = typeof deviceTypes[number];
export function isDeviceType(value: string): value is DeviceType {
  return deviceTypes.includes(value as DeviceType);
}

export default interface Device {
  /**
   * The ID of the device. For real devices, this is usually the USB identifier.
   */
  id: string;
  /**
   * The device type. Values include `'emulator'` for emulators, `'device'` for devices, and `'offline'` for offline devices. `'offline'` can occur for example during boot, in low-battery conditions or when the ADB connection has not yet been approved on the device.
   */
  type: DeviceType;
  /**
   * return a DeviceClient attached to this devices
   */
  getClient: () => DeviceClient;
}
