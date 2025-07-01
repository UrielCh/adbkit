import Command from '../../command.js';
import { Properties } from '../../../models/Properties.js';

const RE_KEYVAL = /^\[([\s\S]*?)\]: \[([\s\S]*?)\]\r?$/gm;

export default class GetPropertiesCommand extends Command<Properties> {
  async execute(): Promise<Properties> {
    this.sendCommand('shell:getprop');
    await this.readOKAY();
    const data = await this.parser.readAll()
    return this._parseProperties(data.toString());
  }

  private _parseProperties(value: string): Properties {
    const properties: Properties = {};
    let match: RegExpExecArray | null;
    while ((match = RE_KEYVAL.exec(value))) {
      properties[match[1]] = match[2];
    }
    return properties;
  }
}
