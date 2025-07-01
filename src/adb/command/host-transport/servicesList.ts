import Command from '../../command.js';

/**
 * see Android Interface Definition Language (AIDL) files
 * 
 * as serviceName.aidl
 * 
 * ex: https://android.googlesource.com/platform/frameworks/base/+/master/telephony/java/com/android/internal/telephony/IPhoneSubInfo.aidl
 */

export type KnownServices = "DockObserver" | "SurfaceFlinger" | "accessibility" | "account" | "activity" | "activity_task" | "adb" | "alarm" | "android.hardware.vibrator.IVibrator/default" | "android.security.identity" | "android.security.keystore" | "android.service.gatekeeper.IGateKeeperService" | "app_binding" | "app_integrity" | "app_prediction" | "applock" | "appops" | "appwidget" | "attention" | "audio" | "auth" | "autofill" | "backup" | "battery" | "batteryproperties" | "batterystats" | "binder_calls_stats" | "biometric" | "blob_store" | "bluetooth_manager" | "bugreport" | "cacheinfo" | "carrier_config" | "clipboard" | "color_display" | "companiondevice" | "connectivity" | "connmetrics" | "consumer_ir" | "content" | "content_capture" | "content_suggestions" | "country_detector" | "cpuinfo" | "crossprofileapps" | "dataloader_manager" | "dbinfo" | "device_config" | "device_identifiers" | "device_policy" | "deviceidle" | "devicestoragemonitor" | "diskstats" | "display" | "dnsresolver" | "dpmservice" | "dreams" | "drm.drmManager" | "dropbox" | "dynamic_system" | "emergency_affordance" | "ethernet" | "external_vibrator_service" | "face" | "file_integrity" | "fingerprint" | "gfxinfo" | "gpu" | "graphicsstats" | "hardware_properties" | "imms" | "incident" | "incidentcompanion" | "incremental" | "input" | "input_method" | "inputflinger" | "installd" | "ions" | "iorapd" | "iphonesubinfo" | "ipsec" | "isms" | "isub" | "jobscheduler" | "launcherapps" | "lights" | "lineagehardware" | "lineagelivedisplay" | "location" | "lock_settings" | "looper_stats" | "manager" | "media.aaudio" | "media.audio_flinger" | "media.audio_policy" | "media.camera" | "media.camera.proxy" | "media.extractor" | "media.metrics" | "media.player" | "media.resource_manager" | "media_projection" | "media_resource_monitor" | "media_router" | "media_session" | "meminfo" | "midi" | "mount" | "netd" | "netd_listener" | "netpolicy" | "netstats" | "network_management" | "network_score" | "network_stack" | "network_time_update_service" | "network_watchlist" | "notification" | "oem_lock" | "otadexopt" | "overlay" | "package" | "package_native" | "permission" | "permissionmgr" | "persistent_data_block" | "phone" | "pinner" | "platform_compat" | "platform_compat_native" | "pocket" | "power" | "print" | "processinfo" | "procstats" | "rcs" | "recovery" | "restrictions" | "role" | "rollback" | "runtime" | "scheduling_policy" | "search" | "sec_key_att_app_id_provider" | "secure_element" | "sensor_privacy" | "sensorservice" | "serial" | "servicediscovery" | "settings" | "shortcut" | "simphonebook" | "sip" | "slice" | "soundtrigger" | "soundtrigger_middleware" | "stats" | "statscompanion" | "statsmanager" | "statusbar" | "storaged" | "storaged_pri" | "storagestats" | "suspend_control" | "system_config" | "system_update" | "telecom" | "telephony.registry" | "telephony_ims" | "testharness" | "tethering" | "textclassification" | "textservices" | "thermalservice" | "time_detector" | "time_zone_detector" | "trust" | "uce" | "uimode" | "updatelock" | "uri_grants" | "usagestats" | "usb" | "user" | "vibrator" | "voiceinteraction" | "vold" | "wallpaper" | "webviewupdate" | "wifi" | "wifinl80211" | "wifip2p" | "wifirtt" | "wifiscanner" | "window";

export interface AdbServiceInfo {
  id: number;
  name: KnownServices | string;
  pkg: string;
}

export default class ServiceListCommand extends Command<AdbServiceInfo[]> {
  async execute(): Promise<AdbServiceInfo[]> {
    this.sendCommand('exec:service list 2>/dev/null');
    await this.readOKAY();
    const data = await this.parser.readAll()
    return this._parse(data.toString());
  }

  private _parse(value: string): AdbServiceInfo[] {
    const packages: AdbServiceInfo[] = [];
    const RE_PACKAGE = /^(\d+)\s+([^:]+): \[(.*)\]\r?$/gm;
    for (;;) {
      const match = RE_PACKAGE.exec(value);
      if (match) {
        const id = Number(match[1]);
        const name = match[2];
        const pkg = match[3];
        packages.push({id, name, pkg});
      } else {
        break;
      }
    }
    return packages;
  }
}
