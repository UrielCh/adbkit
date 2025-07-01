import Command from '../../command.js';
import Device, { DeviceType } from '../../../models/Device.js';
import DeviceClient from '../../DeviceClient.js';
import Tracker from '../../tracker.js';

export default class HostTrackDevicesCommand extends Command<Tracker> {
  async execute(): Promise<Tracker> {
    await this._send('host:track-devices');
    await this.readOKAY();
    return new Tracker(this);
  }

  // copy from HostDevicesCommand.ts
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
