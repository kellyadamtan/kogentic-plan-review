import { describe, expect, it } from 'vitest';
import { addGate, gateHookEntry, hasGate, parseSettings, removeGate, stringifySettings } from '../../src/gate/hookConfig';

describe('Claude Code hook config', () => {
  it('builds an http hook to 127.0.0.1 with the token from an env var', () => {
    expect(gateHookEntry(4815, 3600)).toEqual({
      matcher: 'ExitPlanMode',
      hooks: [{ type: 'http', url: 'http://127.0.0.1:4815/claude/exit-plan', headers: { 'x-kogentic-gate-token': '$KOGENTIC_GATE_TOKEN' }, allowedEnvVars: ['KOGENTIC_GATE_TOKEN'], timeout: 3600, onFailure: 'block' }],
    });
    expect(JSON.stringify(gateHookEntry(1, 1))).not.toMatch(/0\.0\.0\.0|localhost/);
  });
  it('adds idempotently and keeps other settings and hooks', () => {
    const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] };
    const base = { model: 'opus', hooks: { PermissionRequest: [other], Stop: [{ hooks: [] }] } };
    const once = addGate(base, 4815, 3600);
    const twice = addGate(once, 4816, 60);
    expect(hasGate(twice)).toBe(true);
    const list = (twice.hooks as Record<string, unknown[]>).PermissionRequest;
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual(other);
    expect(JSON.stringify(list[1])).toContain('4816');
    expect(twice.model).toBe('opus');
    expect(base.hooks.PermissionRequest).toHaveLength(1); // input not mutated
  });
  it('removes only the gate entry and tidies empty containers', () => {
    expect(removeGate(addGate({}, 4815, 1))).toEqual({});
    const kept = removeGate(addGate({ hooks: { Stop: [] } }, 4815, 1));
    expect(kept).toEqual({ hooks: { Stop: [] } });
    expect(hasGate(kept)).toBe(false);
    expect(removeGate({ a: 1 })).toEqual({ a: 1 });
  });
  it('parses settings text', () => {
    expect(parseSettings('')).toEqual({});
    expect(parseSettings('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseSettings('[]')).toThrow();
    expect(stringifySettings({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});
