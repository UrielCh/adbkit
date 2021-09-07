import { exec, ExecOptions, ExecException } from 'child_process';
import path from 'path';
import fs from 'fs';
import { ChildProcess } from 'node:child_process';

// options: { encoding: BufferEncoding } & ExecOptions, callback?: (error: ExecException | null, stdout: string, stderr: string) => void
function execPromise(command: string, options: { encoding: BufferEncoding } & ExecOptions): Promise<{ stdout: string, stderr: string, exitCode: number }> {
    return new Promise((resolve, reject) => {
        const cp: ChildProcess = exec(command, options, (error: ExecException, stdout: string, stderr: string) => {
            if (error)
                return reject(error);
            resolve({ stdout, stderr, exitCode: cp.exitCode });
        })
    })
}

export default class GitSource {
    workDir: string;
    gitDir: string;
    constructor(public name: string, public url: string) {
        this.workDir = path.resolve(path.join(__dirname, '..', '..'));
        this.gitDir = path.resolve(path.join(this.workDir, name));
    }

    async clone() {
        if (!fs.existsSync(this.gitDir)) {
            console.log('cloning git...');
            await execPromise(`git clone ${this.url} ${this.gitDir}`, { encoding: 'utf8', cwd: this.workDir });
            console.log('clone done');
        }
    }

    async update() {
        console.log('git pull');
        let log = await execPromise(`git pull`, { encoding: 'utf8', cwd: this.gitDir });
        console.log('pull Done');
        console.log(log);

        console.log('git fetch origin');
        log = await execPromise(`git fetch origin`, { encoding: 'utf8', cwd: this.gitDir });
        console.log('Done');
        console.log(log);
    }

    async listBranch(): Promise<string[]> {
        console.log(`listing git branches`);
        let log = await execPromise(`git branch -r --list --no-color`, { encoding: 'utf8', cwd: this.gitDir });
        let branches = log.stdout.split(/[\r\n ]+/g);
        branches = branches.filter(a=>a.startsWith('origin/')).map(a=> a.replace('origin/', ''));
        return branches;
    }

    async listTag(): Promise<string[]> {
        console.log(`listing git tag`);
        let log = await execPromise(`git tag`, { encoding: 'utf8', cwd: this.gitDir });
        let tags = log.stdout.split(/[\r\n ]+/g);
        tags = tags.filter(a=>a.match(/android-(\d+\.){1,2}\d+_r\d+/))
        // .map(a=> a.replace('origin/', ''));
        return tags;
    }

    async checkoutTag(tag: string): Promise<void> {
        console.log(`switch to tag ${tag}`);
        let log = await execPromise(`git checkout tags/${tag}`, { encoding: 'utf8', cwd: this.gitDir });
        console.log(log);
    }

    async listAidl(tag: string): Promise<void> {
        console.log(`switch to tag ${tag}`);
        let log = await execPromise(`git checkout tags/${tag}`, { encoding: 'utf8', cwd: this.gitDir });
        console.log(log);
    }

}