export const SIDECAR_IGNORE = '.kogentic/';

const MATCHES = new Set(['.kogentic', '.kogentic/', '/.kogentic', '/.kogentic/', '.kogentic/*', '/.kogentic/*', '.kogentic/**', '/.kogentic/**']);

/** True if the .gitignore text already ignores the whole .kogentic/ folder. */
export function ignoresSidecars(gitignore: string): boolean {
  return gitignore.split(/\r?\n/).some((l) => MATCHES.has(l.trim()));
}

/** Returns the new .gitignore text, or undefined if .kogentic/ is already ignored. */
export function withSidecarIgnore(gitignore: string): string | undefined {
  if (ignoresSidecars(gitignore)) return undefined;
  const block = '# Kogentic Plan Review sidecars (reviews, approvals)\n' + SIDECAR_IGNORE + '\n';
  if (!gitignore.trim()) return block;
  const eol = gitignore.includes('\r\n') ? '\r\n' : '\n';
  return gitignore.replace(/\s*$/, eol + eol) + block.replace(/\n/g, eol);
}
