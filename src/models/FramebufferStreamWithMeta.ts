import { Duplex } from 'node:stream';
import FramebufferMeta from './FramebufferMeta.js';

export default interface FramebufferStreamWithMeta extends Duplex {
  /**
   * meta data describing the content
   */
  meta: FramebufferMeta;
}
