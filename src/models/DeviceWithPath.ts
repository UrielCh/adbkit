import Device from './Device.js';

export default interface DeviceWithPath extends Device {
  /**
   * The device path. This can be something like `usb:FD120000` for real devices.
   */
  path: string;
  /**
   * The product name of the device
   */
  product: string;
  /**
   * The model of the device
   */
  model: string;
  /**
   * The device
   */
   device: string;
  /**
   * The transport id for the device
   */
  transportId: string;
}
