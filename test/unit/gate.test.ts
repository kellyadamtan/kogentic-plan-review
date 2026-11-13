import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertLoopbackHost, GATE_HOST, GATE_PATH, GateError, GateRequest, GateServer, hookResponse, MAX_BODY, newToken, parseHookBody, tokenMatches } from '../../src/gate/server';
import { canConnect, externalIPv4, request } from './helpers';

// Ports 4800-4809 are reserved for these tests.
let server: GateServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const body = (event = 'PermissionRequest', plan = '# Plan\n1. do it') =>
  JSON.stringify({ hook_event_name: event, session_id: 's1', cwd: '/repo', tool_name: 'ExitPlanMode', tool_input: { plan, planFilePath: '/home/u/.claude/plans/p.md' } });

async function start(port: number, onPlan: (r: GateRequest, s: AbortSignal) => Promise<{ allow: boolean; reason?: string }>, timeoutMs = 5000) {
  server = new GateServer({ port, timeoutMs, onPlan });
  await server.start();
  return server;
}

function post(s: GateServer, headers: Record<string, string> = {}, data = body()) {
  return request({ port: s.port!, path: GATE_PATH, headers: { host: `127.0.0.1:${s.port}`, 'content-type': 'application/json', 'x-kogentic-gate-token': s.token, ...headers }, body: data });
}

describe('bind address', () => {
  it('binds to 127.0.0.1 only', async () => {
    const s = await start(4800, async () => ({ allow: true }));
    expect(s.address).toBe('127.0.0.1');
    expect(s.url).toBe(`http://127.0.0.1:4800${GATE_PATH}`);
    expect(await canConnect('127.0.0.1', 4800)).toBe(true);
  });
  it('is not reachable on a non-loopback interface', async () => {
    const ip = externalIPv4();
    if (!ip) return; // no external interface on this machine
    await start(4801, async () => ({ allow: true }));
    expect(await canConnect(ip, 4801)).toBe(false);
  });
  it('refuses any other host, including 0.0.0.0', () => {
    for (const h of ['0.0.0.0', '::', 'localhost', '::1', '', '192.168.1.2']) {
      expect(() => new GateServer({ port: 4802, host: h, timeoutMs: 1, onPlan: async () => ({ allow: true }) }), h).toThrow(GateError);
      expect(() => assertLoopbackHost(h)).toThrow(GateError);
    }
    expect(() => assertLoopbackHost(GATE_HOST)).not.toThrow();
  });
  it('fails to start when the port is taken', async () => {
    await start(4803, async () => ({ allow: true }));
    const other = new GateServer({ port: 4803, timeoutMs: 1, onPlan: async () => ({ allow: true }) });
    await expect(other.start()).rejects.toThrow();
  });
});

describe('token', () => {
  it('generates a random 64-hex token per session', () => {
    const a = newToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken()).not.toBe(a);
    const s1 = new GateServer({ port: 4804, timeoutMs: 1, onPlan: async () => ({ allow: true }) });
    const s2 = new GateServer({ port: 4804, timeoutMs: 1, onPlan: async () => ({ allow: true }) });
    expect(s1.token).not.toBe(s2.token);
    expect(() => new GateServer({ port: 4804, token: 'short', timeoutMs: 1, onPlan: async () => ({ allow: true }) })).toThrow();
  });
  it('compares tokens exactly', () => {
    const t = 'a'.repeat(64);
    expect(tokenMatches(t, t)).toBe(true);
    expect(tokenMatches(t, 'a'.repeat(63) + 'b')).toBe(false);
    expect(tokenMatches(t, 'a'.repeat(63))).toBe(false);
    expect(tokenMatches(t, t + 'a')).toBe(false);
    expect(tokenMatches(t, undefined)).toBe(false);
    expect(tokenMatches(t, '')).toBe(false);
    expect(tokenMatches(t, [t])).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
  });
  it('rejects requests without the token, or with a wrong one, before reading the plan', async () => {
    const onPlan = vi.fn(async () => ({ allow: true }));
    const s = await start(4805, onPlan);
    const missing = await request({ port: 4805, path: GATE_PATH, headers: { host: '127.0.0.1:4805' }, body: body() });
    expect(missing.status).toBe(401);
    const wrong = await post(s, { 'x-kogentic-gate-token': newToken() });
    expect(wrong.status).toBe(401);
    const prefix = await post(s, { 'x-kogentic-gate-token': s.token.slice(0, 32) });
    expect(prefix.status).toBe(401);
    const bearer = await post(s, { 'x-kogentic-gate-token': '', authorization: `Bearer ${s.token}` });
    expect(bearer.status).toBe(401);
    expect(onPlan).not.toHaveBeenCalled();
    const ok = await post(s);
    expect(ok.status).toBe(200);
    expect(onPlan).toHaveBeenCalledTimes(1);
  });
});

describe('gate requests', () => {
  it('allows when the plan is approved, echoing the tool input', async () => {
    let seen: GateRequest | undefined;
    const s = await start(4806, async (r) => {
      seen = r;
      return { allow: true };
    });
    const res = await post(s);
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { plan: '# Plan\n1. do it', planFilePath: '/home/u/.claude/plans/p.md' } } } });
    expect(seen).toMatchObject({ hookEvent: 'PermissionRequest', plan: '# Plan\n1. do it', sessionId: 's1', cwd: '/repo', planFilePath: '/home/u/.claude/plans/p.md' });
  });
  it('denies with the reviewer feedback, in PreToolUse shape too', async () => {
    const s = await start(4807, async () => ({ allow: false, reason: 'Add tests first' }));
    expect((await post(s)).json()).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Add tests first' } } });
    expect((await post(s, {}, body('PreToolUse'))).json()).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Add tests first' } });
  });
  it('denies on timeout and aborts the pending review', async () => {
    let aborted = false;
    const s = await start(4808, (_r, sig) => new Promise(() => sig.addEventListener('abort', () => (aborted = true))), 200);
    const res = (await post(s)).json() as { hookSpecificOutput: { decision: { behavior: string; message: string } } };
    expect(res.hookSpecificOutput.decision.behavior).toBe('deny');
    expect(res.hookSpecificOutput.decision.message).toMatch(/timeout/);
    expect(aborted).toBe(true);
  });
  it('denies when the review callback throws', async () => {
    const s = await start(4809, async () => {
      throw new Error('boom');
    });
    const r = (await post(s)).json() as { hookSpecificOutput: { decision: { behavior: string } } };
    expect(r.hookSpecificOutput.decision.behavior).toBe('deny');
  });
  it('rejects bad hosts, browser origins, wrong paths and methods, bad bodies', async () => {
    const onPlan = vi.fn(async () => ({ allow: true }));
    const s = await start(4809, onPlan);
    expect((await post(s, { host: 'evil.example:4809' })).status).toBe(403);
    expect((await post(s, { host: '127.0.0.1:1' })).status).toBe(403);
    expect((await post(s, { host: 'localhost:4809' })).status).toBe(200);
    expect((await post(s, { origin: 'https://evil.example' })).status).toBe(403);
    const opt = await request({ port: 4809, method: 'OPTIONS', path: GATE_PATH, headers: { host: '127.0.0.1:4809', origin: 'https://x' } });
    expect(opt.status).toBe(403);
    expect(opt.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request({ port: 4809, path: '/other', headers: { host: '127.0.0.1:4809', 'x-kogentic-gate-token': s.token }, body: '{}' })).status).toBe(404);
    expect((await request({ port: 4809, method: 'GET', path: GATE_PATH, headers: { host: '127.0.0.1:4809', 'x-kogentic-gate-token': s.token } })).status).toBe(405);
    expect((await post(s, {}, 'not json')).status).toBe(400);
    expect((await post(s, {}, JSON.stringify({ tool_name: 'Bash', tool_input: {} }))).status).toBe(400);
    expect((await post(s, {}, 'x'.repeat(MAX_BODY + 10)).catch(() => ({ status: 413 }))).status).toBe(413);
    expect(onPlan).toHaveBeenCalledTimes(1);
  });
});

describe('payload helpers', () => {
  it('parses hook bodies', () => {
    expect(parseHookBody('{"tool_input":{"plan":"p"}}')).toEqual({ hookEvent: 'PermissionRequest', plan: 'p', sessionId: undefined, cwd: undefined, planFilePath: undefined, toolInput: { plan: 'p' } });
    expect(() => parseHookBody('[]x')).toThrow();
    expect(() => parseHookBody('null')).toThrow();
  });
  it('builds default reasons', () => {
    expect(hookResponse('PreToolUse', { allow: true }, { plan: 'x' })).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Approved in Kogentic Plan Review.', updatedInput: { plan: 'x' } } });
  });
});
