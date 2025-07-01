import StartServiceOptions from './StartServiceOptions.js';

export default interface StartActivityOptions extends StartServiceOptions {
  /**
   * Set to `true` to enable debugging.
   */
  debug?: boolean;
  /**
   * Set to `true` to wait for the activity to launch.
   */
  wait?: boolean;
}
