export interface Extra {
  /**
   * The key name.
   */
  key: string;
  /**
   * The type, which can be one of `'string'`, `'null'`, `'bool'`, `'int'`, `'long'`, `'float'`, `'uri'`, `'component'`.
   */
  type: 'string' | 'null' | 'bool' | 'int' | 'long' | 'float' | 'uri' | 'component';
  /**
   * The value. Optional and unused if type is `'null'`. If an `Array`, type is automatically set to be an array of `<type>`.
   */
  value?: string | number | boolean | string[] | number[] | boolean[];
}

/**
 * When an `Object`, each key is treated as the key name. Simple values like `null`, `String`, `Boolean` and `Number` are type-mapped automatically (`Number` maps to `'int'`) and
 * can be used as-is. For more complex types, like arrays and URIs, set the value to be an `Object` like in the Array syntax (see above), but leave out the `key` property.
 */
export interface ExtraObject {
  [index: string]: ExtraValue;
}

export type ExtraValue = number | string | boolean | ExtraObject;

export default interface StartServiceOptions {
  /**
   * The user to run as. Not set by default. If the option is unsupported by the device, an attempt will be made to run the same command again without the user option.
   */
  user?: number;
  /**
   * The action.
   */
  action?: string;
  /**
   * The data URI, if any.
   */
  data?: string;
  /**
   * The mime type, if any.
   */
  mimeType?: string;
  /**
   * The category. For multiple categories, pass an `Array`.
   */
  category?: string | string[];
  /**
   * The component.
   */
  component?: string;
  /**
   * Numeric flags.
   */
  flags?: number | number[];
  /**
   * Any extra data.
   */
  extras?: Extra[] | ExtraObject;
}
