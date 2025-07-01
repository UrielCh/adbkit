import Command from '../../command.js';
import Device, { DeviceType } from '../../../models/Device.js';
import DeviceClient from '../../DeviceClient.js';

export default class HostDevicesCommand extends Command<Device[]> {
  async execute(): Promise<Device[]> {
    await this._send('host:devices');
    await this.readOKAY();
    return this._readDevices();
  }

  // copyed to HostTrackDevicesCommand.ts
  public async _readDevices(): Promise<Device[]> {
    const value = await this.parser.readValue('ascii');
    return this._parseDevices(value);
  }

  _parseDevices(value: string): Device[] {
    return value
      .split('\n')
      .filter((e) => e)
      .map((line: string) => {
        const [id, type] = line.split(/\s+/);
        return {
          id,
          type: type as DeviceType,
          getClient: () => new DeviceClient(this.connection.parent, id),
        };
      });
  }
}
