import { type pki } from 'node-forge';
type PublicKey = pki.rsa.PublicKey;

export default interface ExtendedPublicKey extends PublicKey {
  /**
   * The key fingerprint, like it would display on a device. Note that this is different than the one you'd get from `forge.ssh.getPublicKeyFingerprint(key)`, because the device fingerprint is based on the original format.
   */
  fingerprint: string;
  /**
   * The key comment, if any.
   */
  comment: string;
}
