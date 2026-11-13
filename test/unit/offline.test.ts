import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * Offline guard: the extension has no telemetry, listens on no port and makes
 * no network calls except through the opt-in connector.
 * This checks the whole bundle, dependencies included, plus the webview script.
 */
const ROOT = join(__dirname, '..', '..');

/** Node built-ins the bundle may use, and which source file may use each. "*" = anywhere. */
const ALLOWED: Record<string, string[]> = {
  vscode: ['*'],
  fs: ['*'],
  'fs/promises': ['*'],
  path: ['*'],
  os: ['*'],
  crypto: ['*'],
  process: ['*'],
  buffer: ['*'],
  'node:fs': ['*'],
  'node:fs/promises': ['*'],
  'node:path': ['*'],
  'node:os': ['*'],
  'node:crypto': ['*'],
  'node:child_process': ['src/vscode/git.ts'],
};

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (ext.test(n)) out.push(p);
  }
  return out;
}

describe('offline guard', () => {
  it('the bundle (with all dependencies) only uses allowed built-in modules, from allowed files', async () => {
    const r = await esbuild.build({ entryPoints: [join(ROOT, 'src/extension.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, metafile: true, logLevel: 'silent', absWorkingDir: ROOT });
    const used: string[] = [];
    for (const [input, info] of Object.entries(r.metafile.inputs)) {
      for (const imp of info.imports) {
        if (!imp.external) continue;
        const allowed = ALLOWED[imp.path];
        used.push(`${imp.path} <- ${input}`);
        expect(allowed, `${input} imports ${imp.path}`).toBeDefined();
        expect(allowed.includes('*') || allowed.includes(input), `${input} may not import ${imp.path}`).toBe(true);
      }
    }
    expect(used.some((u) => /^node:(http|https|net|tls|dgram|dns|http2) /.test(u))).toBe(false);
  });

  it('only the connector calls fetch, and nothing listens or uses other network APIs', () => {
    const src = [...files(join(ROOT, 'src'), /\.ts$/), ...files(join(ROOT, 'media'), /\.js$/)];
    for (const f of src) {
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      const text = readFileSync(f, 'utf8');
      if (rel !== 'src/core/connector.ts') expect(/\bfetch\b/.test(text), `${rel} uses fetch`).toBe(false);
      expect(/XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.|\bimport\s*\(/.test(text), `${rel} uses a network API or dynamic import`).toBe(false);
      expect(/\b(https?|net|tls|dgram|dns|http2)\.(request|get|connect|createConnection|lookup|createServer)\b|\.listen\(/.test(text), `${rel} opens or accepts connections`).toBe(false);
    }
  });

  it('the connector sends only via sendPlan, with redirects off', () => {
    const text = readFileSync(join(ROOT, 'src/core/connector.ts'), 'utf8');
    expect(text.match(/fetchImpl\(/g)).toHaveLength(1);
    expect(text).toContain("redirect: 'manual'");
    expect(text).not.toMatch(/redirect:\s*'follow'/);
  });
});
