import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

/** The only address the gate ever binds to. */
export const GATE_HOST = '127.0.0.1';
export const GATE_PATH = '/claude/exit-plan';
export const TOKEN_HEADER = 'x-kogentic-gate-token';
export const TOKEN_ENV = 'KOGENTIC_GATE_TOKEN';
export const MAX_BODY = 1024 * 1024;

export interface GateRequest {
  hookEvent: string;
  plan: string;
  sessionId?: string;
  cwd?: string;
  planFilePath?: string;
  /** The tool input as received; echoed back as updatedInput on allow, which ExitPlanMode requires. */
  toolInput: Record<string, unknown>;
}

export interface GateDecision {
  allow: boolean;
  reason?: string;
}

export interface GateOptions {
  port: number;
  /** Must be 127.0.0.1. Anything else is refused. */
  host?: string;
  /** Per-session token; generated when omitted. */
  token?: string;
  timeoutMs: number;
  onPlan: (req: GateRequest, signal: AbortSignal) => Promise<GateDecision>;
}

export class GateError extends Error {}

/** A fresh random token: 32 bytes, hex. */
export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export function assertLoopbackHost(host: string): void {
  if (host !== GATE_HOST) {
    throw new GateError(`The gate only binds to ${GATE_HOST}; refusing ${host}.`);
  }
}

/** Constant-time token check. */
export function tokenMatches(expected: string, got: string | string[] | undefined): boolean {
  if (typeof got !== 'string' || got.length === 0 || expected.length === 0) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(got, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isLoopbackRemote(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::ffff:127.0.0.1' || addr === '::1';
}

/** Hook response in the shape Claude Code expects for the event that called us. */
export function hookResponse(hookEvent: string, d: GateDecision, toolInput: Record<string, unknown> = {}): Record<string, unknown> {
  const reason = d.reason ?? (d.allow ? 'Approved in Kogentic Plan Review.' : 'Rejected in Kogentic Plan Review.');
  if (hookEvent === 'PreToolUse') {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.allow ? 'allow' : 'deny', permissionDecisionReason: reason, ...(d.allow ? { updatedInput: toolInput } : {}) } };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: d.allow ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: reason },
    },
  };
}

/** Pulls the plan out of a Claude Code hook payload. */
export function parseHookBody(raw: string): GateRequest {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new GateError('body is not JSON');
  }
  if (!v || typeof v !== 'object') throw new GateError('body is not an object');
  const o = v as Record<string, unknown>;
  const input = (o.tool_input && typeof o.tool_input === 'object' ? o.tool_input : {}) as Record<string, unknown>;
  if (o.tool_name !== undefined && o.tool_name !== 'ExitPlanMode') throw new GateError('not an ExitPlanMode call');
  const plan = typeof input.plan === 'string' ? input.plan : '';
  return {
    hookEvent: typeof o.hook_event_name === 'string' ? o.hook_event_name : 'PermissionRequest',
    plan,
    sessionId: typeof o.session_id === 'string' ? o.session_id : undefined,
    cwd: typeof o.cwd === 'string' ? o.cwd : undefined,
    planFilePath: typeof input.planFilePath === 'string' ? input.planFilePath : undefined,
    toolInput: input,
  };
}

/**
 * Local HTTP endpoint for the Claude Code ExitPlanMode hook. It binds to
 * 127.0.0.1 only, requires the per-session token header, checks the Host
 * header (DNS rebinding) and holds each request until the user decides.
 */
export class GateServer {
  readonly token: string;
  private server?: http.Server;
  private readonly host: string;

  constructor(private readonly opts: GateOptions) {
    this.host = opts.host ?? GATE_HOST;
    assertLoopbackHost(this.host);
    this.token = opts.token ?? newToken();
    if (this.token.length < 32) throw new GateError('gate token is too short');
  }

  get port(): number | undefined {
    const a = this.server?.address() as AddressInfo | null | undefined;
    return a ? a.port : undefined;
  }

  get address(): string | undefined {
    const a = this.server?.address() as AddressInfo | null | undefined;
    return a ? a.address : undefined;
  }

  get url(): string | undefined {
    return this.port ? `http://${GATE_HOST}:${this.port}${GATE_PATH}` : undefined;
  }

  start(): Promise<number> {
    if (this.server) return Promise.resolve(this.port as number);
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.headersTimeout = 10_000;
    server.requestTimeout = 0; // requests are held while the user reviews
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port: this.opts.port, host: this.host, exclusive: true }, () => {
        server.off('error', reject);
        this.server = server;
        resolve(this.port as number);
      });
    });
  }

  stop(): Promise<void> {
    const s = this.server;
    this.server = undefined;
    if (!s) return Promise.resolve();
    return new Promise((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections?.();
    });
  }

  private send(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
    if (res.headersSent) return;
    const data = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) });
    res.end(data);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!isLoopbackRemote(req.socket.remoteAddress)) return this.send(res, 403, { error: 'forbidden' });
    const host = (req.headers.host ?? '').toLowerCase();
    const port = this.port;
    if (host !== `${GATE_HOST}:${port}` && host !== `localhost:${port}`) return this.send(res, 403, { error: 'bad host' });
    if (req.headers.origin) return this.send(res, 403, { error: 'browser requests are not allowed' });
    const url = (req.url ?? '').split('?')[0];
    if (url !== GATE_PATH) return this.send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return this.send(res, 405, { error: 'method not allowed' });
    if (!tokenMatches(this.token, req.headers[TOKEN_HEADER])) return this.send(res, 401, { error: 'unauthorized' });

    let raw = '';
    let size = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          size += Buffer.byteLength(chunk);
          if (size > MAX_BODY) {
            reject(new GateError('too large'));
            req.destroy();
            return;
          }
          raw += chunk;
        });
        req.on('end', () => resolve());
        req.on('error', reject);
      });
    } catch {
      return this.send(res, 413, { error: 'body too large' });
    }

    let gr: GateRequest;
    try {
      gr = parseHookBody(raw);
    } catch (e) {
      return this.send(res, 400, { error: (e as Error).message });
    }

    const ctrl = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) ctrl.abort();
    };
    res.on('close', onClose);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<GateDecision>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve({ allow: false, reason: 'No decision before the review timeout, so the plan was not approved.' });
      }, this.opts.timeoutMs);
    });
    let decision: GateDecision;
    try {
      decision = await Promise.race([this.opts.onPlan(gr, ctrl.signal), timeout]);
    } catch (e) {
      decision = { allow: false, reason: `Plan review failed: ${(e as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
    this.send(res, 200, hookResponse(gr.hookEvent, decision, gr.toolInput));
  }
}
