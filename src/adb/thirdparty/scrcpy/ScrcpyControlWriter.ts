import { Buffer } from 'node:buffer';
import {
  ControlMessageMap,
  MotionEventMap,
  SurfaceControlMap,
  type ControlMessage,
  type MotionEvent,
  type SurfaceControl,
} from './ScrcpyConst.js';
import type { KeyCodes } from '../../keycode.js';
import { BufWrite } from '../minicap/BufWrite.js';
import type { Point } from './ScrcpyModels.js';

/**
 * Serialize a single-byte control message (e.g. expand/collapse panels, zoom, rotate).
 */
export function buildSimpleControlMessage(type: ControlMessage): Buffer {
  const chunk = Buffer.allocUnsafe(1);
  chunk.writeUInt8(type, 0);
  return chunk;
}

/**
 * Serialize a `TYPE_INJECT_KEYCODE` control message.
 */
export function buildKeycodeMessage(
  action: MotionEvent,
  keyCode: KeyCodes,
  repeatCount: number,
  metaState: number,
): Buffer {
  const chunk = new BufWrite(14);
  chunk.writeUint8(ControlMessageMap.TYPE_INJECT_KEYCODE);
  chunk.writeUint8(action);
  chunk.writeUint32BE(keyCode);
  chunk.writeUint32BE(repeatCount);
  chunk.writeUint32BE(metaState);
  return chunk.buffer;
}

/**
 * Serialize a string-payload control message (`TYPE_INJECT_TEXT`, `TYPE_START_APP`, `TYPE_SCAN_FILE`).
 */
export function buildStringControlMessage(type: ControlMessage, value: string): Buffer {
  const chunk = new BufWrite(5);
  chunk.writeUint8(type);
  chunk.writeString(value);
  return chunk.buffer;
}

/**
 * Serialize a `TYPE_INJECT_TOUCH_EVENT` control message.
 */
export function buildTouchEventMessage(
  major: number,
  action: MotionEvent,
  pointerId: bigint,
  position: Point,
  screenSize: Point,
  pressure: number = MotionEventMap.ACTION_UP,
  actionButton: number = MotionEventMap.BUTTON_PRIMARY,
  buttons: number = MotionEventMap.BUTTON_PRIMARY,
): Buffer {
  const size = major >= 2 ? 32 : 28;
  const chunk = new BufWrite(size);
  chunk.writeUint8(ControlMessageMap.TYPE_INJECT_TOUCH_EVENT);
  chunk.writeUint8(action);

  const resolvedPressure = pressure === undefined
    ? (action === MotionEventMap.ACTION_UP ? 0x0 : 0xffff)
    : pressure;

  chunk.writeBigUint64BE(pointerId);
  chunk.writeUint32BE(position.x | 0);
  chunk.writeUint32BE(position.y | 0);
  chunk.writeUint16BE(screenSize.x | 0);
  chunk.writeUint16BE(screenSize.y | 0);
  chunk.writeUint16BE(resolvedPressure);

  if (major >= 2) {
    chunk.writeUint32BE(actionButton);
  }
  chunk.writeUint32BE(buttons);
  return chunk.buffer;
}

/**
 * Serialize a `TYPE_INJECT_SCROLL_EVENT` control message.
 */
export function buildScrollEventMessage(
  position: Point,
  screenSize: Point,
  hScroll: number,
  vScroll: number,
): Buffer {
  const chunk = new BufWrite(23);
  chunk.writeUint8(ControlMessageMap.TYPE_INJECT_SCROLL_EVENT);
  chunk.writeUint32BE(position.x | 0);
  chunk.writeUint32BE(position.y | 0);
  chunk.writeUint16BE(screenSize.x | 0);
  chunk.writeUint16BE(screenSize.y | 0);
  chunk.writeUint16BE(hScroll);
  chunk.writeInt32BE(vScroll);
  chunk.writeInt32BE(MotionEventMap.BUTTON_PRIMARY);
  return chunk.buffer;
}

/**
 * Serialize a `TYPE_BACK_OR_SCREEN_ON` control message.
 */
export function buildBackOrScreenOnMessage(): Buffer {
  const chunk = new BufWrite(2);
  chunk.writeUint8(ControlMessageMap.TYPE_BACK_OR_SCREEN_ON);
  chunk.writeUint8(MotionEventMap.ACTION_UP);
  return chunk.buffer;
}

/**
 * Serialize a `TYPE_SET_CLIPBOARD` control message with paste enabled.
 */
export function buildSetClipboardMessage(text: string): Buffer {
  const chunk = new BufWrite(6);
  chunk.writeUint8(ControlMessageMap.TYPE_SET_CLIPBOARD);
  chunk.writeUint8(1); // paste
  chunk.writeString(text);
  return chunk.buffer;
}

/**
 * Serialize a `TYPE_SET_SCREEN_POWER_MODE` / `TYPE_SET_DISPLAY_POWER` control message.
 */
export function buildSetScreenPowerModeMessage(
  major: number,
  mode: SurfaceControl | boolean = SurfaceControlMap.POWER_MODE_NORMAL,
): Buffer {
  const chunk = Buffer.allocUnsafe(2);
  chunk.writeUInt8(ControlMessageMap.TYPE_SET_SCREEN_POWER_MODE, 0);
  if (major >= 3) {
    // In scrcpy 3.0+, it is boolean on/off
    const on = typeof mode === 'boolean' ? mode : mode === SurfaceControlMap.POWER_MODE_NORMAL;
    chunk.writeUInt8(on ? 1 : 0, 1);
  } else {
    // In scrcpy 2.x and earlier, it is SurfaceControl power mode byte
    const rawMode = typeof mode === 'boolean'
      ? (mode ? SurfaceControlMap.POWER_MODE_NORMAL : SurfaceControlMap.POWER_MODE_OFF)
      : mode;
    chunk.writeUInt8(rawMode, 1);
  }
  return chunk;
}

/**
 * Serialize a `TYPE_CAMERA_SET_TORCH` control message.
 */
export function buildSetCameraTorchMessage(on: boolean): Buffer {
  const chunk = Buffer.allocUnsafe(2);
  chunk.writeUInt8(ControlMessageMap.TYPE_CAMERA_SET_TORCH, 0);
  chunk.writeUInt8(on ? 1 : 0, 1);
  return chunk;
}

/**
 * Serialize a `TYPE_RESIZE_DISPLAY` control message.
 */
export function buildResizeDisplayMessage(width: number, height: number): Buffer {
  const chunk = Buffer.allocUnsafe(5);
  chunk.writeUInt8(ControlMessageMap.TYPE_RESIZE_DISPLAY, 0);
  chunk.writeUInt16BE(width, 1);
  chunk.writeUInt16BE(height, 3);
  return chunk;
}
