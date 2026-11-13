import { constants, promises as fs } from 'node:fs';
import * as path from 'node:path';

export class UnsafePathError extends Error {}

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Refuses a write target that is a symbolic link, sits below a symbolic link,
 * or resolves outside root. The root itself may be reached through a link
 * (a workspace opened via a symlinked path is fine).
 */
export async function assertSafeTarget(root: string, target: string): Promise<void> {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(target);
  if (!isInside(absRoot, absTarget) || absTarget === absRoot) throw new UnsafePathError(`Refusing to write outside the workspace: ${target}`);
  const realRoot = await fs.realpath(absRoot);
  let cur = absRoot;
  let lastExisting = absRoot;
  for (const part of path.relative(absRoot, absTarget).split(path.sep)) {
    cur = path.join(cur, part);
    let st;
    try {
      st = await fs.lstat(cur);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw e;
    }
    if (st.isSymbolicLink()) throw new UnsafePathError(`Refusing to write through a symbolic link: ${cur}`);
    lastExisting = cur;
  }
  if (!isInside(realRoot, await fs.realpath(lastExisting))) throw new UnsafePathError(`Refusing to write outside the workspace: ${target}`);
}

async function writeNoFollow(file: string, data: string, flags: number): Promise<void> {
  const fh = await fs.open(file, flags | NOFOLLOW, 0o644);
  try {
    await fh.writeFile(data, 'utf8');
  } finally {
    await fh.close();
  }
}

/** Creates parent folders, then writes (or appends) without following links. */
export async function safeWrite(root: string, target: string, data: string, mode: 'replace' | 'append' = 'replace'): Promise<void> {
  await assertSafeTarget(root, target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await assertSafeTarget(root, target);
  const flags = constants.O_WRONLY | constants.O_CREAT | (mode === 'append' ? constants.O_APPEND : constants.O_TRUNC);
  await writeNoFollow(target, data, flags);
}

/** Reads a file inside root, refusing links; a missing file reads as ''. */
export async function safeRead(root: string, target: string): Promise<string> {
  await assertSafeTarget(root, target);
  try {
    return await fs.readFile(target, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw e;
  }
}
