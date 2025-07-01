import Command from '../../command.js';
import { KnownServices } from './servicesList.js';

export default class ServiceCheckCommand extends Command<boolean> {
  async execute(serviceName: KnownServices | string): Promise<boolean> {
    this.sendCommand(`exec:service check ${serviceName} 2>/dev/null`);
    await this.readOKAY();
    const data = await this.parser.readAll()
    return this._parse(data.toString());
  }

  private _parse(value: string): boolean {
    if (value.includes('not found'))
      return false;
    if (value.includes('found'))
      return true;
    return false;
  }
}
