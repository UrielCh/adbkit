import Command from '../../command.js';
import DeviceWithPath from '../../../models/DeviceWithPath.js';
import DeviceClient from '../../DeviceClient.js';
import { isDeviceType } from '../../../models/Device.js';


export default class HostDevicesWithPathsCommand extends Command<DeviceWithPath[]> {
  async execute(): Promise<DeviceWithPath[]> {
    await this._send('host:devices-l');
    await this.readOKAY();
    return this._readDevices();
  }


  public async _readDevices(): Promise<DeviceWithPath[]> {
    const value = await this.parser.readValue('ascii');
    return this._parseDevices(value);
  }

  private _parseDevices(value: string): DeviceWithPath[] {
    const regexp = /^([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+product:([^\s]+)\s+model:([^\s]+)\s+device:([^\s]+)\s+transport_id:([^\s]+)$/gm;
    const devices: DeviceWithPath[] = [];
    let match;
    while ((match = regexp.exec(value)) !== null) {
      const [, id, type, path, product, model, device, transportId] = match;
      if (!isDeviceType(type)) {
        continue;
      }
      devices.push({
        id,
        type,
        path,
        product,
        model,
        device,
        transportId,
        getClient: () => new DeviceClient(this.connection.parent, id),
      })
    }
    return devices;
  }
}
