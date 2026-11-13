import { describe, expect, it } from 'vitest';
import { ignoresSidecars, withSidecarIgnore } from '../../src/core/gitignore';

describe('.gitignore entry for .kogentic/', () => {
  it('adds the entry once', () => {
    const first = withSidecarIgnore('node_modules/\n')!;
    expect(first).toBe('node_modules/\n\n# Kogentic Plan Review sidecars (reviews, approvals)\n.kogentic/\n');
    expect(withSidecarIgnore(first)).toBeUndefined();
    expect(withSidecarIgnore('')).toBe('# Kogentic Plan Review sidecars (reviews, approvals)\n.kogentic/\n');
  });
  it('recognises existing forms', () => {
    for (const l of ['.kogentic', '/.kogentic/', '  .kogentic/  ', '.kogentic/**']) expect(ignoresSidecars(`a\n${l}\nb`), l).toBe(true);
    for (const l of ['.kogentic/reviews/', '#.kogentic/', '!.kogentic/', 'kogentic/']) expect(ignoresSidecars(l), l).toBe(false);
  });
  it('keeps CRLF files CRLF', () => {
    expect(withSidecarIgnore('a\r\n')).toBe('a\r\n\r\n# Kogentic Plan Review sidecars (reviews, approvals)\r\n.kogentic/\r\n');
  });
});
