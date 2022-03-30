export enum MessageType {
    DO_IDENTIFY = 1,
    DO_KEYEVENT = 2,
    DO_TYPE = 3,
    DO_WAKE = 4,
    DO_ADD_ACCOUNT_MENU = 24,
    DO_REMOVE_ACCOUNT = 20,
    GET_ACCOUNTS = 26,
    GET_BROWSERS = 5,
    GET_CLIPBOARD = 6,
    GET_DISPLAY = 19,
    GET_PROPERTIES = 7,
    GET_RINGER_MODE = 27,
    GET_SD_STATUS = 25,
    GET_VERSION = 8,
    GET_WIFI_STATUS = 23,
    GET_BLUETOOTH_STATUS = 29,
    GET_ROOT_STATUS = 31,
    SET_CLIPBOARD = 9,
    SET_KEYGUARD_STATE = 10,
    SET_RINGER_MODE = 21,
    SET_ROTATION = 12,
    SET_WAKE_LOCK = 11,
    SET_WIFI_ENABLED = 22,
    SET_BLUETOOTH_ENABLED = 30,
    SET_MASTER_MUTE = 28,
    EVENT_AIRPLANE_MODE = 13,
    EVENT_BATTERY = 14,
    EVENT_CONNECTIVITY = 15,
    EVENT_PHONE_STATE = 16,
    EVENT_ROTATION = 17,
    EVENT_BROWSER_PACKAGE = 18
}

export interface AirplaneModeEvent {
    enabled: boolean;
}

export interface BatteryEvent {
    status: string;
    health: string;
    source: string;
    level: number;
    scale: number;
    temp: number;
    voltage: number;
}

export interface BrowserApp {
    name: string;
    component: string;
    selected: boolean;
    system: boolean;
}

export interface BrowserApp {
    name: string;
    component: string;
    selected: boolean;
    system: boolean;
}

export interface BrowserPackageEvent {
    selected: boolean;
    apps: BrowserApp;
}

export interface ConnectivityEvent {
    connected: boolean;
    type?: string;
    subtype?: string;
    failover?: boolean;
    roaming?: boolean;
}

export interface PhoneStateEvent {
    state: string;
    manual: boolean;
    operator?: string;
}

export interface RotationEvent {
    rotation: number;
}

export interface Envelope {
    id?: number;
    type: MessageType;
    message: Uint8Array;
}

export interface GetAccountsRequest {
    type?: string;
}

export interface GetAccountsResponse {
   success: boolean;
   accounts: string;
}

export interface GetBrowsersResponse {
    success: boolean;
    selected: boolean;
    apps: BrowserApp[];
}

export interface GetClipboardResponse {
    success: boolean;
    type?: ClipboardType;
    text?: string;
}

export interface GetDisplayResponse {
    success: boolean;
    width?: number;
    height?: number;
    xdpi?: number;
    ydpi?: number;
    fps?: number;
    density?: number;
    rotation?: number;
    secure?: boolean;
}

export interface Property {
    name: string;
    value: string;
}

export interface GetPropertiesResponse {
    success: boolean;
    properties: Property[];
}

export enum RingerMode {
    SILENT = 0,
    VIBRATE = 1,
    NORMAL = 2,
}

export interface GetRingerModeResponse {
    success: boolean;
    mode: RingerMode;
}

export interface SetRingerModeRequest {
    mode: RingerMode;
}

export interface SetRingerModeResponse {
    success: boolean;
}


export enum ClipboardType {
    TEXT = 1,
}

export interface GetClipboardRequest {
    type: ClipboardType
}

export interface GetDisplayRequest {
    id: number;
}

export interface GetPropertiesRequest {
    properties: string[];
}

// export interface GetWifiStatusRequest {
// }

export interface GetWifiStatusResponse {
    success: boolean;
    status: boolean;
}

// export interface GetRootStatusRequest {
// }

export interface GetRootStatusResponse {
    success: boolean;
    status: boolean;
}

export interface SetBluetoothEnabledRequest {
    enabled: boolean;
}

export interface SetBluetoothEnabledResponse {
    success: boolean;
}

// export interface GetBluetoothStatusRequest {
// }

export interface GetBluetoothStatusResponse {
    success: boolean;
    status: boolean;
}

// export interface GetSdStatusRequest {
// }

export interface GetSdStatusResponse {
    success: boolean;
    mounted: boolean;
}

export interface SetMasterMuteRequest {
    enabled: boolean;
}

export interface SetMasterMuteResponse {
    success: boolean;
}

export interface GetVersionResponse {
    success: boolean;
    version?: string;
}


export interface SetClipboardRequest {
    type: ClipboardType ;
    text?: string;
}

export interface SetClipboardResponse {
    success: boolean;
}

export interface  SetKeyguardStateRequest {
    enabled: boolean;
}

export interface  SetKeyguardStateResponse {
    success: boolean;
}

export interface  SetWakeLockRequest {
    enabled: boolean;
}

export interface SetWakeLockResponse {
    success: boolean;
}

export interface SetRotationRequest {
    rotation: number;
    lock: boolean;
}

export interface SetWifiEnabledRequest {
    enabled: boolean;
}

export interface SetWifiEnabledResponse {
    success: boolean;
}
