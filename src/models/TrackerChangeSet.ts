import Device from './Device.js';

/**
 * An object with the following properties always present:
 */
export default interface TrackerChangeSet {
  /**
   * An array of removed device objects, each one as in the `remove` event. Empty if none.
   */
  removed: Device[];
  /**
   * An array of changed device objects, each one as in the `change` event. Empty if none.
   */
  changed: Device[];
  /**
   * An array of added device objects, each one as in the `add` event. Empty if none.
   */
  added: Device[];
}
