export { createClient, type AdbOptions } from './adb.js';
export type { ClientOptions } from './models/ClientOptions.js';
export type { DeviceClientOptions } from './models/DeviceClientOptions.js';

export type { CpuStats, Loads } from './models/CpuStats.js';
export type { default as Device, DeviceType } from './models/Device.js';

export type { default as DeviceWithPath } from './models/DeviceWithPath.js';
export type { default as ExtendedPublicKey } from './models/ExtendedPublicKey.js';
export type { Features } from './models/Features.js';
export type { default as Forward } from './models/Forward.js';
export type { default as FramebufferMeta } from './models/FramebufferMeta.js';
export type { default as FramebufferStreamWithMeta } from './models/FramebufferStreamWithMeta.js';
export type { Properties } from './models/Properties.js';
export type { default as Reverse } from './models/Reverse.js';
export type { default as SocketOptions } from './models/SocketOptions.js';
export type { default as StartActivityOptions } from './models/StartActivityOptions.js';
export type { default as StartServiceOptions, ExtraValue, ExtraObject, Extra } from './models/StartServiceOptions.js';
export type { default as TrackerChangeSet } from './models/TrackerChangeSet.js';
export type { default as WithToString } from './models/WithToString.js';
export type { ColorFormat } from './models/FramebufferMeta.js';

export { default as Service, PrematurePacketError, LateTransportError } from './adb/tcpusb/service.js';
export { default as ServiceMap } from './adb/tcpusb/servicemap.js';
export { default as RollingCounter } from './adb/tcpusb/rollingcounter.js';
export { default as Packet } from './adb/tcpusb/packet.js';
export { default as Socket, AuthError, UnauthorizedError } from './adb/tcpusb/socket.js';
export { default as PacketReader, ChecksumError, MagicError } from './adb/tcpusb/packetreader.js';
export { default as Parser } from './adb/parser.js';
export { AdbUnexpectedDataError, AdbPrematureEOFError, AdbFailError, AdbError } from './adb/errors.js';

export { default as Client } from './adb/client.js';
export { default as DeviceClient } from './adb/DeviceClient.js';
export { default as Connection } from './adb/connection.js';
export { default as TcpUsbServer } from './adb/tcpusb/server.js';
export { default as Tracker } from './adb/tracker.js';
export { default as DeviceClientExtra } from './adb/DeviceClientExtra.js';
export { default as JdwpTracker } from './adb/jdwptracker.js';

export { default as Sync } from './adb/sync.js';
export { default as PullTransfer } from './adb/sync/pulltransfer.js';
export { default as Pushtransfer } from './adb/sync/pushtransfer.js';
export { default as Entry64 } from './adb/sync/entry64.js';
export { default as Entry } from './adb/sync/entry.js';
export { default as Stats64 } from './adb/sync/stats64.js';
export { default as Stats } from './adb/sync/stats.js';

export { default as ProcStat } from './adb/proc/stat.js';
export type { LoadsWithLine, CpuStatsWithLine, ProcStats } from './adb/proc/stat.js';

export { KeyEventMap, type KeyEvent } from './adb/thirdparty/STFService/STFServiceModel.js';
export type { KeyEventRequest } from './adb/thirdparty/STFService/STFServiceModel.js';

// export android key enumeration as object
export { KeyCodesMap, type KeyCodes } from './adb/keycode.js';

export type { RebootType, PsEntry, ProcessState, AdbServiceInfo } from './adb/command/host-transport/index.js';
export { ShellCommand, IpRuleEntry, IpRouteEntry } from './adb/command/host-transport/index.js';

export type { ServiceCallArg, ServiceCallArgNumber, ServiceCallArgString, ServiceCallArgNull } from './adb/command/host-transport/serviceCall.js';
export { default as ServiceCallCommand, ParcelReader } from './adb/command/host-transport/serviceCall.js';

// give access to Utils class ( readAll and parsePublicKey)
export { default as Utils } from './adb/utils.js';

export { default as Scrcpy } from './adb/thirdparty/scrcpy/Scrcpy.js';
export { MotionEventMap, DeviceMessageTypeMap, SurfaceControlMap, OrientationMap, KeyEventMetaMap } from './adb/thirdparty/scrcpy/ScrcpyConst.js';
export type { MotionEvent, DeviceMessageType, SurfaceControl, Orientation, KeyEventMeta } from './adb/thirdparty/scrcpy/ScrcpyConst.js';

export type { MinicapOptions } from './adb/thirdparty/minicap/Minicap.js';
export { default as Minicap } from './adb/thirdparty/minicap/Minicap.js';

export { type STFServiceOptions } from './adb/thirdparty/STFService/STFService.js';
export { default as STFService } from './adb/thirdparty/STFService/STFService.js';
export { type MyMessage } from './adb/thirdparty/STFService/STFServiceBuf.js';
export { default as STFServiceBuf } from './adb/thirdparty/STFService/STFServiceBuf.js';

export type { Point, ScrcpyOptions, VideoStreamFramePacket, H264Configuration } from './adb/thirdparty/scrcpy/ScrcpyModels.js';

export { default as DevicePackage, } from './adb/DevicePackage.js';
export type { PackageInfo } from './adb/DevicePackage.js';

/**
 * main entry point
 */
import { createClient } from './adb.js';

import { default as util } from './adb/utils.js';

/**
 * Keep @u4/adbkit v3.x old adb export
 */
export const Adb = {
  util,
  createClient
}

export * as STFServiceModel from './adb/thirdparty/STFService/STFServiceModel.js';

/**
 * Keep @u4/adbkit v3.x default export shape
 */
export default Adb;