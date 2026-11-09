import { DeviceType } from '../../../models/Device.js';
import Command from '../../command.js';

abstract class HostSerialValueCommand<T extends string = string> extends Command<T> {
  protected abstract readonly subCommand: string;

  async execute(serial: string): Promise<T> {
    await this._send(`host-serial:${serial}:${this.subCommand}`);
    await this.readOKAY();
    return this.parser.readValue('utf8') as Promise<T>;
  }
}

abstract class HostSerialBoolCommand extends Command<boolean> {
  protected abstract readonly subCommand: string;

  async execute(serial: string): Promise<boolean> {
    await this._send(`host-serial:${serial}:${this.subCommand}`);
    await this.readOKAY();
    return true;
  }
}

export class GetDevicePathCommand extends HostSerialValueCommand<string> {
  protected readonly subCommand = 'get-devpath';
}

export class GetSerialNoCommand extends HostSerialValueCommand<string> {
  protected readonly subCommand = 'get-serialno';
}

export class GetStateCommand extends HostSerialValueCommand<DeviceType> {
  protected readonly subCommand = 'get-state';
}

export class AttachCommand extends HostSerialBoolCommand {
  protected readonly subCommand = 'attach';
}

export class DetachCommand extends HostSerialBoolCommand {
  protected readonly subCommand = 'detach';
}

export { default as ForwardCommand } from './forward.js';
export { default as KillForwardCommand } from './killForward.js';
export { default as ListForwardsCommand } from './listforwards.js';
export { default as WaitForDeviceCommand } from './waitfordevice.js';
