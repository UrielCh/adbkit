import { expect } from 'chai';
import Command from '../../src/adb/command.js';

class TestCommand extends Command<string> {
  public async execute(data: string): Promise<string> {
    return this.sendCommand(data);
  }
}

describe('Command.sendCommand', () => {
  const createCommand = (sudo: boolean): { cmd: TestCommand; sent: string[] } => {
    const sent: string[] = [];
    const mockConn: any = {
      parser: { lastMessage: '' },
      write: async (buf: Buffer) => {
        sent.push(buf.toString('utf8'));
        return buf.length;
      },
    };
    return {
      cmd: new TestCommand(mockConn, { sudo }),
      sent,
    };
  };

  it('should POSIX-escape single quotes in shell: commands when sudo is true', async () => {
    const { cmd } = createCommand(true);
    const result = await cmd.execute("shell:echo 'hello world'");
    expect(result).to.equal("shell:su -c 'echo '\"'\"'hello world'\"'\"''");
  });

  it('should POSIX-escape single quotes in exec: commands when sudo is true', async () => {
    const { cmd } = createCommand(true);
    const result = await cmd.execute("exec:echo 'hello world'");
    expect(result).to.equal("exec:su -c 'echo '\"'\"'hello world'\"'\"''");
  });

  it('should not wrap non-shell commands when sudo is true', async () => {
    const { cmd } = createCommand(true);
    const result = await cmd.execute('host:version');
    expect(result).to.equal('host:version');
  });
});
