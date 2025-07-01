

// Action from android.view.MotionEvent
// https://github.com/aosp-mirror/platform_frameworks_base/blob/master/core/java/android/view/MotionEvent.java
export const MotionEventMap = {
    ACTION_DOWN : 0,
    ACTION_UP : 1,
    ACTION_MOVE : 2,
    ACTION_CANCEL : 3,
    ACTION_OUTSIDE : 4,
    ACTION_POINTER_DOWN : 5,
    ACTION_POINTER_UP : 6,
    ACTION_HOVER_MOVE : 7,
    ACTION_SCROLL : 8,
    ACTION_HOVER_ENTER : 9,
    ACTION_HOVER_EXIT : 10,
    ACTION_BUTTON_PRESS : 11,
    ACTION_BUTTON_RELEASE : 12,

    BUTTON_PRIMARY : 1 << 0,
    BUTTON_SECONDARY : 1 << 1,
    BUTTON_TERTIARY : 1 << 2,
    BUTTON_BACK : 1 << 3,
    BUTTON_FORWARD : 1 << 4,
    BUTTON_STYLUS_PRIMARY : 1 << 5,
    BUTTON_STYLUS_SECONDARY : 1 << 6,
} as const;
export type MotionEvent = typeof MotionEventMap[keyof typeof MotionEventMap];

// fro m DeviceMessage.java
export const DeviceMessageTypeMap = {
    TYPE_CLIPBOARD : 0,
} as const;
export type DeviceMessageType = typeof DeviceMessageTypeMap[keyof typeof DeviceMessageTypeMap];

// Screen power mode from Device.java
export const SurfaceControlMap = {
    POWER_MODE_OFF : 0,
    POWER_MODE_NORMAL : 2,
} as const;
export type SurfaceControl = typeof SurfaceControlMap[keyof typeof SurfaceControlMap];

// types from Device.java
export const OrientationMap = {
    LOCK_VIDEO_ORIENTATION_UNLOCKED : -1,
    LOCK_VIDEO_ORIENTATION_INITIAL : -2,
    // from android source
    LOCK_SCREEN_ORIENTATION_0 : 0,
    LOCK_SCREEN_ORIENTATION_1 : 1,
    LOCK_SCREEN_ORIENTATION_2 : 2,
    LOCK_SCREEN_ORIENTATION_3 : 3,
} as const;

export type Orientation = typeof OrientationMap[keyof typeof OrientationMap];

// Lock screen orientation
export const ControlMessageMap = {
    TYPE_INJECT_KEYCODE : 0,
    TYPE_INJECT_TEXT : 1,
    TYPE_INJECT_TOUCH_EVENT : 2,
    TYPE_INJECT_SCROLL_EVENT : 3,
    TYPE_BACK_OR_SCREEN_ON : 4,
    TYPE_EXPAND_NOTIFICATION_PANEL : 5,
    TYPE_EXPAND_SETTINGS_PANEL : 6,
    TYPE_COLLAPSE_PANELS : 7,
    TYPE_GET_CLIPBOARD : 8,
    TYPE_SET_CLIPBOARD : 9,
    TYPE_SET_SCREEN_POWER_MODE : 10,
    TYPE_ROTATE_DEVICE : 11,
} as const;
export type ControlMessage = typeof ControlMessageMap[keyof typeof ControlMessageMap];

export const KeyEventMetaMap = {
    META_CTRL_LEFT_ON :  0x00002000,
    META_CTRL_ON :       0x00007000,
    META_META_MASK :     0x00070000,
    META_CAPS_LOCK_ON :  0x00100000,
    META_CTRL_RIGHT_ON : 0x00004000,
    META_META_LEFT_ON :  0x00020000,
} as const;
export type KeyEventMeta = typeof KeyEventMetaMap[keyof typeof KeyEventMetaMap];
