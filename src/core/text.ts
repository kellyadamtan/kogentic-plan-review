import { createHash } from 'node:crypto';

/** SHA-256 hex digest of a string. */
export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Normalizes a path mentioned in a plan to a repo-relative, forward-slash form. */
export function normalizePath(p: string): string {
  let s = p.trim().replace(/\\/g, '/');
  s = s.replace(/^[`'"(<]+|[`'"),.;:>]+$/g, '');
  s = s.replace(/:\d+(-\d+)?$/, ''); // file.ts:12 or file.ts:12-20
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

const FILE_EXT = /\.[A-Za-z0-9]{1,10}$/;
const KNOWN_FILES = new Set([
  'Dockerfile', 'Makefile', 'Procfile', 'Gemfile', 'Rakefile', 'Jenkinsfile', 'LICENSE',
  '.env', '.gitignore', '.npmrc', '.dockerignore', '.editorconfig',
]);

/** Reports whether a token looks like a file or folder path rather than code or prose. */
export function looksLikePath(tok: string): boolean {
  const t = normalizePath(tok);
  if (!t || t.length > 200) return false;
  if (/\s/.test(t) || /[<>|&;$"'=(){}]/.test(t) || t.includes('://')) return false;
  if (t.startsWith('-') || t.startsWith('@') || t.startsWith('#')) return false;
  if (/^\d+(\.\d+)*$/.test(t)) return false; // version numbers
  const base = t.split('/').pop() ?? t;
  if (KNOWN_FILES.has(base) || /^\.env(\.[\w-]+)?$/.test(base)) return true;
  if (t.includes('/')) {
    if (t.startsWith('/') || t.startsWith('~')) return FILE_EXT.test(base);
    return FILE_EXT.test(base) || t.endsWith('/');
  }
  // bare file name: needs a letter-led name and a short code-like extension
  return /^[A-Za-z_][\w.-]*\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|md|mdc|go|py|rb|rs|java|kt|cs|c|h|cpp|hpp|sql|sh|css|scss|html|vue|svelte|swift|php|lock|txt|xml|gradle|tf|proto)$/.test(t);
}

/** Lines that read as vague instructions (shared idea with kogentic-rules-lint V001). */
export const VAGUE_PHRASES: readonly string[] = [
  'make it better', 'make it cleaner', 'clean up', 'as needed', 'where appropriate', 'when appropriate',
  'if needed', 'best practices', 'properly', 'be careful', 'etc.', 'and so on', 'somehow', 'tbd', 'todo: figure out',
  'refactor as necessary', 'improve', 'polish', 'tweak',
];

export function findVague(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const p of VAGUE_PHRASES) {
    const re = new RegExp(`(^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`);
    if (re.test(lower)) found.push(p);
  }
  return found;
}

/** Escapes text for HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
