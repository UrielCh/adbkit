import ExtendedPublicKey from './ExtendedPublicKey.js';

export default interface SocketOptions {
  auth?: (key: ExtendedPublicKey) => Promise<void | boolean>;
}
