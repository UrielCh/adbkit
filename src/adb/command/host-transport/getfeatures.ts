import Command from '../../command.js';
import { Features } from '../../../models/Features.js';

const RE_FEATURE = /^feature:(.*?)(?:=(.*?))?\r?$/gm;

export default class GetFeaturesCommand extends Command<Features> {
  async execute(): Promise<Features> {
    this.sendCommand('shell:pm list features 2>/dev/null');
    await this.readOKAY();
    const data = await this.parser.readAll();
    return this._parseFeatures(data.toString());
  }

  private _parseFeatures(value: string): Features {
    const features: Features = {};
    let match: RegExpExecArray | null;
    while ((match = RE_FEATURE.exec(value))) {
      features[match[1]] = match[2] || true;
    }
    return features;
  }
}
