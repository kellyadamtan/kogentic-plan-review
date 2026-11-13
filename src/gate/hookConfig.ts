import { GATE_HOST, GATE_PATH, TOKEN_ENV, TOKEN_HEADER } from './server';

export const HOOK_EVENT = 'PermissionRequest';
export const HOOK_MATCHER = 'ExitPlanMode';

type Json = Record<string, unknown>;

export function gateUrl(port: number): string {
  return `http://${GATE_HOST}:${port}${GATE_PATH}`;
}

/** The hook entry written into .claude/settings.local.json. The token itself is never written. */
export function gateHookEntry(port: number, timeoutSeconds: number): Json {
  return {
    matcher: HOOK_MATCHER,
    hooks: [
      {
        type: 'http',
        url: gateUrl(port),
        headers: { [TOKEN_HEADER]: `$${TOKEN_ENV}` },
        allowedEnvVars: [TOKEN_ENV],
        timeout: timeoutSeconds,
        onFailure: 'block',
      },
    ],
  };
}

function isGateHook(h: unknown): boolean {
  if (!h || typeof h !== 'object') return false;
  const url = (h as Json).url;
  return typeof url === 'string' && url.startsWith(`http://${GATE_HOST}:`) && url.endsWith(GATE_PATH);
}

function isGateEntry(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const hooks = (e as Json).hooks;
  return Array.isArray(hooks) && hooks.some(isGateHook);
}

/** Returns settings with exactly one gate entry (replacing any earlier one). Other settings are kept. */
export function addGate(settings: Json, port: number, timeoutSeconds: number): Json {
  const out: Json = JSON.parse(JSON.stringify(settings ?? {}));
  const hooks: Json = out.hooks && typeof out.hooks === 'object' && !Array.isArray(out.hooks) ? (out.hooks as Json) : {};
  const list = Array.isArray(hooks[HOOK_EVENT]) ? (hooks[HOOK_EVENT] as unknown[]).filter((e) => !isGateEntry(e)) : [];
  list.push(gateHookEntry(port, timeoutSeconds));
  hooks[HOOK_EVENT] = list;
  out.hooks = hooks;
  return out;
}

/** Removes the gate entry; drops now-empty containers. */
export function removeGate(settings: Json): Json {
  const out: Json = JSON.parse(JSON.stringify(settings ?? {}));
  const hooks = out.hooks as Json | undefined;
  if (!hooks || typeof hooks !== 'object') return out;
  if (Array.isArray(hooks[HOOK_EVENT])) {
    const list = (hooks[HOOK_EVENT] as unknown[]).filter((e) => !isGateEntry(e));
    if (list.length) hooks[HOOK_EVENT] = list;
    else delete hooks[HOOK_EVENT];
  }
  if (Object.keys(hooks).length === 0) delete out.hooks;
  return out;
}

export function hasGate(settings: Json): boolean {
  const hooks = settings?.hooks as Json | undefined;
  return !!hooks && Array.isArray(hooks[HOOK_EVENT]) && (hooks[HOOK_EVENT] as unknown[]).some(isGateEntry);
}

/** Parses settings JSON text; empty text is an empty object. */
export function parseSettings(text: string): Json {
  if (!text.trim()) return {};
  const v: unknown = JSON.parse(text);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('settings file is not a JSON object');
  return v as Json;
}

export function stringifySettings(s: Json): string {
  return JSON.stringify(s, null, 2) + '\n';
}
