// generarted by genProto.ts
import { Buffer } from 'node:buffer';
import * as protobuf from 'protobufjs';
import { Message, Root } from 'protobufjs';
import ThirdUtils from '../ThirdUtils.js';
import * as STF from './STFServiceModel.js';

const { load } = protobuf;

let singleton: Promise<STFServiceBuf> | null = null;
export type MyMessage<T extends object = object> = Message<T> & T;
let root: Root;

export default class STFServiceBuf {
  private static async internalInit(): Promise<STFServiceBuf> {
    const proto = ThirdUtils.getResourcePath('wireService.proto');
    const _root = await load(proto);
    root = _root;
    return new STFServiceBuf(_root);
  }

  public static get(): Promise<STFServiceBuf> {
    if (!singleton) singleton = this.internalInit();
    return singleton;
  }

  private constructor(private _root: Root) {
  }

  get root(): Root {
    return this._root;
  }
  
  readEnvelope(data: Uint8Array): MyMessage<STF.Envelope> {
    const type = root.lookupType('Envelope');
    return type.decode(data) as MyMessage<STF.Envelope>;
  }
  
  readEnvelopeDelimited(data: Uint8Array): MyMessage<STF.Envelope> {
    const type = root.lookupType('Envelope');
    return type.decodeDelimited(data) as MyMessage<STF.Envelope>;
  }

  public write = {
    Envelope(env: STF.Envelope): Buffer {
      const type = root.lookupType('Envelope');
      return Buffer.from(type.encodeDelimited(env).finish());
    },
    GetVersionRequest(req: STF.GetVersionRequest): Buffer {
      const type = root.lookupType('GetVersionRequest');
      return Buffer.from(type.encode(req).finish());
    },
    SetKeyguardStateRequest(req: STF.SetKeyguardStateRequest): Buffer {
      const type = root.lookupType('SetKeyguardStateRequest');
      return Buffer.from(type.encode(req).finish());
    },
    SetWakeLockRequest(req: STF.SetWakeLockRequest): Buffer {
      const type = root.lookupType('SetWakeLockRequest');
      return Buffer.from(type.encode(req).finish());
    },
    SetClipboardRequest(req: STF.SetClipboardRequest): Buffer {
      const type = root.lookupType('SetClipboardRequest');
      return Buffer.from(type.encode(req).finish());
    },
    GetClipboardRequest(req: STF.GetClipboardRequest): Buffer {
      const type = root.lookupType('GetClipboardRequest');
      return Buffer.from(type.encode(req).finish());
    },
    GetBrowsersRequest(req: STF.GetBrowsersRequest): Buffer {
      const type = root.lookupType('GetBrowsersRequest');
      return Buffer.from(type.encode(req).finish());
    },
    GetDisplayRequest(req: STF.GetDisplayRequest): Buffer {
      const type = root.lookupType('GetDisplayRequest');
      return Buffer.from(type.encode(req).finish());
    },
    GetPropertiesRequest(req: STF.GetPropertiesRequest): Buffer {
      const type = root.lookupType('GetPropertiesRequest');
      return Buffer.from(type.encode(req).finish());
    },
    DoIdentifyRequest(req: STF.DoIdentifyRequest): Buffer {
      const type = root.lookupType('DoIdentifyRequest');
      return Buffer.from(type.encode(req).finish());
    },
    GetAccountsRequest(req: STF.GetAccountsRequest): Buffer {
      const type = root.lookupType('GetAccountsRequest');
      return Buffer.from(type.encode(req).finish());
    },
    DoAddAccountMenuRequest(req: STF.DoAddAccountMenuRequest): Buffer {
      const type = root.lookupType('DoAddAccountMenuRequest');
      return Buffer.from(type.encode(req).finish());
    },
    DoRemoveAccountRequest(req: STF.DoRemoveAccountRequest): Buffer {
      const type = root.lookupType('DoRemoveAccountRequest');
      return Buffer.from(type.encode(req).finish());
    },
    SetRingerModeRequest(req: STF.SetRingerModeRequest): Buffer {
      const type = root.lookupType('SetRingerModeRequest');
      return Buffer.from(type.encode(req).finish());
    },
    GetRingerModeRequest(req: STF.GetRingerModeRequest): Buffer {
      const type = root.lookupType('GetRingerModeRequest');
      return Buffer.from(type.encode(req).finish());
    },
    SetWifiEnabledRequest(req: STF.SetWifiEnabledRequest): Buffer {
      const type = root.lookupType('SetWifiEnabledRequest');
      return Buffer.from(type.encode(req).finish());
    },
    GetWifiStatusRequest(req: STF.GetWifiStatusRequest): Buffer {
      const type = root.lookupType('GetWifiStatusRequest');
      return Buffer.from(type.encode(req).finish());
    },
    GetRootStatusRequest(req: STF.GetRootStatusRequest): Buffer {
      const type = root.lookupType('GetRootStatusRequest');
      return Buffer.from(type.encode(req).finish());
    },
    SetBluetoothEnabledRequest(req: STF.SetBluetoothEnabledRequest): Buffer {
      const type = root.lookupType('SetBluetoothEnabledRequest');
      return Buffer.from(type.encode(req).finish());
    },
    GetBluetoothStatusRequest(req: STF.GetBluetoothStatusRequest): Buffer {
      const type = root.lookupType('GetBluetoothStatusRequest');
      return Buffer.from(type.encode(req).finish());
    },
    GetSdStatusRequest(req: STF.GetSdStatusRequest): Buffer {
      const type = root.lookupType('GetSdStatusRequest');
      return Buffer.from(type.encode(req).finish());
    },
    SetMasterMuteRequest(req: STF.SetMasterMuteRequest): Buffer {
      const type = root.lookupType('SetMasterMuteRequest');
      return Buffer.from(type.encode(req).finish());
    },
    KeyEventRequest(req: STF.KeyEventRequest): Buffer {
      const type = root.lookupType('KeyEventRequest');
      return Buffer.from(type.encode(req).finish());
    },
    DoTypeRequest(req: STF.DoTypeRequest): Buffer {
      const type = root.lookupType('DoTypeRequest');
      return Buffer.from(type.encode(req).finish());
    },
    SetRotationRequest(req: STF.SetRotationRequest): Buffer {
      const type = root.lookupType('SetRotationRequest');
      return Buffer.from(type.encode(req).finish());
    },
    DoWakeRequest(req: STF.DoWakeRequest): Buffer {
      const type = root.lookupType('DoWakeRequest');
      return Buffer.from(type.encode(req).finish());
    },
  }

  public read = {
    Envelope(data: Uint8Array): MyMessage<STF.Envelope> {
      const type = root.lookupType('Envelope');
      return type.decode(data) as MyMessage<STF.Envelope>;
    },
    AirplaneModeEvent(data: Uint8Array): MyMessage<STF.AirplaneModeEvent> {
      const type = root.lookupType('AirplaneModeEvent');
      return type.decode(data) as MyMessage<STF.AirplaneModeEvent>;
    },
    BatteryEvent(data: Uint8Array): MyMessage<STF.BatteryEvent> {
      const type = root.lookupType('BatteryEvent');
      return type.decode(data) as MyMessage<STF.BatteryEvent>;
    },
    BrowserApp(data: Uint8Array): MyMessage<STF.BrowserApp> {
      const type = root.lookupType('BrowserApp');
      return type.decode(data) as MyMessage<STF.BrowserApp>;
    },
    BrowserPackageEvent(data: Uint8Array): MyMessage<STF.BrowserPackageEvent> {
      const type = root.lookupType('BrowserPackageEvent');
      return type.decode(data) as MyMessage<STF.BrowserPackageEvent>;
    },
    ConnectivityEvent(data: Uint8Array): MyMessage<STF.ConnectivityEvent> {
      const type = root.lookupType('ConnectivityEvent');
      return type.decode(data) as MyMessage<STF.ConnectivityEvent>;
    },
    PhoneStateEvent(data: Uint8Array): MyMessage<STF.PhoneStateEvent> {
      const type = root.lookupType('PhoneStateEvent');
      return type.decode(data) as MyMessage<STF.PhoneStateEvent>;
    },
    RotationEvent(data: Uint8Array): MyMessage<STF.RotationEvent> {
      const type = root.lookupType('RotationEvent');
      return type.decode(data) as MyMessage<STF.RotationEvent>;
    },
    GetVersionResponse(data: Uint8Array): MyMessage<STF.GetVersionResponse> {
      const type = root.lookupType('GetVersionResponse');
      return type.decode(data) as MyMessage<STF.GetVersionResponse>;
    },
    SetKeyguardStateResponse(data: Uint8Array): MyMessage<STF.SetKeyguardStateResponse> {
      const type = root.lookupType('SetKeyguardStateResponse');
      return type.decode(data) as MyMessage<STF.SetKeyguardStateResponse>;
    },
    SetWakeLockResponse(data: Uint8Array): MyMessage<STF.SetWakeLockResponse> {
      const type = root.lookupType('SetWakeLockResponse');
      return type.decode(data) as MyMessage<STF.SetWakeLockResponse>;
    },
    SetClipboardResponse(data: Uint8Array): MyMessage<STF.SetClipboardResponse> {
      const type = root.lookupType('SetClipboardResponse');
      return type.decode(data) as MyMessage<STF.SetClipboardResponse>;
    },
    GetClipboardResponse(data: Uint8Array): MyMessage<STF.GetClipboardResponse> {
      const type = root.lookupType('GetClipboardResponse');
      return type.decode(data) as MyMessage<STF.GetClipboardResponse>;
    },
    GetBrowsersResponse(data: Uint8Array): MyMessage<STF.GetBrowsersResponse> {
      const type = root.lookupType('GetBrowsersResponse');
      return type.decode(data) as MyMessage<STF.GetBrowsersResponse>;
    },
    GetDisplayResponse(data: Uint8Array): MyMessage<STF.GetDisplayResponse> {
      const type = root.lookupType('GetDisplayResponse');
      return type.decode(data) as MyMessage<STF.GetDisplayResponse>;
    },
    Property(data: Uint8Array): MyMessage<STF.Property> {
      const type = root.lookupType('Property');
      return type.decode(data) as MyMessage<STF.Property>;
    },
    GetPropertiesResponse(data: Uint8Array): MyMessage<STF.GetPropertiesResponse> {
      const type = root.lookupType('GetPropertiesResponse');
      return type.decode(data) as MyMessage<STF.GetPropertiesResponse>;
    },
    DoIdentifyResponse(data: Uint8Array): MyMessage<STF.DoIdentifyResponse> {
      const type = root.lookupType('DoIdentifyResponse');
      return type.decode(data) as MyMessage<STF.DoIdentifyResponse>;
    },
    GetAccountsResponse(data: Uint8Array): MyMessage<STF.GetAccountsResponse> {
      const type = root.lookupType('GetAccountsResponse');
      return type.decode(data) as MyMessage<STF.GetAccountsResponse>;
    },
    DoAddAccountMenuResponse(data: Uint8Array): MyMessage<STF.DoAddAccountMenuResponse> {
      const type = root.lookupType('DoAddAccountMenuResponse');
      return type.decode(data) as MyMessage<STF.DoAddAccountMenuResponse>;
    },
    DoRemoveAccountResponse(data: Uint8Array): MyMessage<STF.DoRemoveAccountResponse> {
      const type = root.lookupType('DoRemoveAccountResponse');
      return type.decode(data) as MyMessage<STF.DoRemoveAccountResponse>;
    },
    SetRingerModeResponse(data: Uint8Array): MyMessage<STF.SetRingerModeResponse> {
      const type = root.lookupType('SetRingerModeResponse');
      return type.decode(data) as MyMessage<STF.SetRingerModeResponse>;
    },
    GetRingerModeResponse(data: Uint8Array): MyMessage<STF.GetRingerModeResponse> {
      const type = root.lookupType('GetRingerModeResponse');
      return type.decode(data) as MyMessage<STF.GetRingerModeResponse>;
    },
    SetWifiEnabledResponse(data: Uint8Array): MyMessage<STF.SetWifiEnabledResponse> {
      const type = root.lookupType('SetWifiEnabledResponse');
      return type.decode(data) as MyMessage<STF.SetWifiEnabledResponse>;
    },
    GetWifiStatusResponse(data: Uint8Array): MyMessage<STF.GetWifiStatusResponse> {
      const type = root.lookupType('GetWifiStatusResponse');
      return type.decode(data) as MyMessage<STF.GetWifiStatusResponse>;
    },
    GetRootStatusResponse(data: Uint8Array): MyMessage<STF.GetRootStatusResponse> {
      const type = root.lookupType('GetRootStatusResponse');
      return type.decode(data) as MyMessage<STF.GetRootStatusResponse>;
    },
    SetBluetoothEnabledResponse(data: Uint8Array): MyMessage<STF.SetBluetoothEnabledResponse> {
      const type = root.lookupType('SetBluetoothEnabledResponse');
      return type.decode(data) as MyMessage<STF.SetBluetoothEnabledResponse>;
    },
    GetBluetoothStatusResponse(data: Uint8Array): MyMessage<STF.GetBluetoothStatusResponse> {
      const type = root.lookupType('GetBluetoothStatusResponse');
      return type.decode(data) as MyMessage<STF.GetBluetoothStatusResponse>;
    },
    GetSdStatusResponse(data: Uint8Array): MyMessage<STF.GetSdStatusResponse> {
      const type = root.lookupType('GetSdStatusResponse');
      return type.decode(data) as MyMessage<STF.GetSdStatusResponse>;
    },
    SetMasterMuteResponse(data: Uint8Array): MyMessage<STF.SetMasterMuteResponse> {
      const type = root.lookupType('SetMasterMuteResponse');
      return type.decode(data) as MyMessage<STF.SetMasterMuteResponse>;
    },
  }
}
