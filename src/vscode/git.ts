import { execFile } from 'node:child_process';
import * as os from 'node:os';

function run(cwd: string | undefined, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 3000, windowsHide: true }, (err, stdout) => resolve(err ? undefined : stdout.trim() || undefined));
  });
}

/** Reviewer name from git config, else the OS user name. */
export async function reviewerName(cwd?: string): Promise<string> {
  return (await run(cwd, ['config', 'user.name'])) ?? os.userInfo().username;
}

export function headSha(cwd?: string): Promise<string | undefined> {
  return run(cwd, ['rev-parse', 'HEAD']);
}
