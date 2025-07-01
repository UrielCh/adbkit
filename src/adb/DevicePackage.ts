import DeviceClient from './DeviceClient.js';

// export interface DevicePackageDump {
//     'Activity Resolver Table': {
//         'Full MIME Types': {[mime: string]: any};
//         'Base MIME Types': {[mime: string]: any};
//         'Schemes': any;
//         'Non-Data Actions': {[action: string]: any};
//         'MIME Typed Actions': {[action: string]: any};
//     },
//     'Receiver Resolver Table': {
//         'Non-Data Actions': {[action: string]: any};
//     }
//     'Service Resolver Table': {
//         'Non-Data Actions': {[action: string]: any};
//     },
//     'Provider Resolver Table': {
//         'Non-Data Actions': {[action: string]: any};
//     },
//     'Preferred Activities User 0': {
//         'Non-Data Actions': {[action: string]: any};
//     },
//     Permissions: Array<any>;
//     'Registered ContentProviders': {[action: string]: any};
//     'ContentProvider Authorities': {[action: string]: any};
//     'Key Set Manager': {[action: string]: any};
//     Packages: {
//     }
// }


export interface PackageInfo {
    userId: number
    pkg: string;
    codePath: string;
    resourcePath: string;
    legacyNativeLibraryDir: string;
    primaryCpuAbi: string;
    secondaryCpuAbi: string;
    versionCode: string;
    minSdk: string;
    targetSdk: string;
    versionName: string;
    apkSigningVersion: string;
    dataDir: string;
    timeStamp: string;
    firstInstallTime: string;
    lastUpdateTime: string;
    installPermissionsFixed: string;//  true / false
}

export default class DevicePackage {
  #name: string;
  constructor(private client: DeviceClient, name: string) {
    this.#name = name;
  }

  get name(): string {
    return this.#name;
  }

  async dump(): Promise<string> {
    return this.client.execOut(`dumpsys package ${this.#name}`, 'utf-8');
  }

  async getInfo(): Promise<PackageInfo> {
    let raw = await this.dump();
    const indexStart = raw.indexOf('\nPackages:');
    if (indexStart === -1)
      throw Error('invalid dumpsys package input');
    raw = raw.substring(indexStart+1);
    const end = raw.search(/\n\w/m);
    if (end >= 0) raw = raw.substring(0, end);
    const result = {} as {[key: string]: string};
    for (const m of raw.matchAll(/(\w+)=(.+)/g)) {
      result[m[1]] = m[2];
    }
    return result as unknown as PackageInfo;
  }
}