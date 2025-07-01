import { DeviceType } from '../../../models/Device.js';
import Command from '../../command.js';

export default class GetStateCommand extends Command<string> {
  async execute(serial: string): Promise<DeviceType> {
    await this._send(`host-serial:${serial}:get-state`);
    await this.readOKAY();
    return this.parser.readValue('utf8') as Promise<DeviceType>;
  }
}
