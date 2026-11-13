import type { ChecklistResult } from './checklist';
import type { Plan } from './plan';

/** SecretStorage key for the optional Kogentic API key. */
export const SECRET_KEY = 'kogentic.apiKey';

export class ConnectorError extends Error {}

/** The connector is opt-in: only an explicit `true` enables it. */
export function connectorEnabled(setting: unknown): boolean {
  return setting === true;
}

/**
 * Validates the configured base URL. There is no default. https is required,
 * except plain http to localhost / loopback for a local mock server.
 */
export function validateBaseUrl(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) throw new ConnectorError('No Kogentic base URL is set (kogenticPlanReview.kogentic.baseUrl). There is no default.');
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new ConnectorError(`Invalid Kogentic base URL: ${s}`);
  }
  if (u.username || u.password) throw new ConnectorError('The base URL must not contain credentials.');
  if (u.protocol === 'http:') {
    const h = u.hostname.replace(/^\[|\]$/g, '');
    if (!(h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h))) {
      throw new ConnectorError('Plain http:// is only allowed for localhost. Use https://.');
    }
  } else if (u.protocol !== 'https:') {
    throw new ConnectorError(`Unsupported URL scheme ${u.protocol}`);
  }
  return u.toString().replace(/\/+$/, '');
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  const i = key.indexOf('_');
  const prefix = i > 0 && i <= 4 ? key.slice(0, i + 1) : '';
  return `${prefix}…${key.slice(-4)}`;
}

export interface PlanPayload {
  agent: string;
  title: string;
  body_md: string;
  hash: string;
  files_touched: string[];
  checklist: { risks: number; items: { id: string; level: string; label: string }[] };
  repo: { name: string; sha?: string };
}

/** Exactly what "Send to Kogentic" uploads. It is shown to the user before sending. */
export function buildPlanPayload(plan: Plan, checklist: ChecklistResult, repo: { name: string; sha?: string }): PlanPayload {
  return {
    agent: plan.agent,
    title: plan.title,
    body_md: plan.body,
    hash: plan.hash,
    files_touched: plan.files,
    checklist: { risks: checklist.risks, items: checklist.items.map((i) => ({ id: i.id, level: i.level, label: i.label })) },
    repo,
  };
}

export interface SendResult {
  plan_id: string;
  url?: string;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; redirect: 'manual'; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; type?: string; json(): Promise<unknown> }>;

/**
 * Redirects are never followed: a 3xx could move the key and the plan to
 * plain http or to another host. Any redirect is treated as a failure.
 */
export function isRedirect(res: { status: number; type?: string }): boolean {
  return res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400);
}

/** POST <base>/v1/plans. Only called after the user confirmed the payload. */
export async function sendPlan(baseUrl: string, apiKey: string, payload: PlanPayload, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 20000): Promise<SendResult> {
  const base = validateBaseUrl(baseUrl);
  if (!apiKey) throw new ConnectorError('No Kogentic API key. Run "Kogentic: Sign In to Kogentic" first.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/v1/plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: ctrl.signal,
    });
    if (isRedirect(res)) {
      throw new ConnectorError(`Kogentic answered with a redirect (HTTP ${res.status}). Redirects are not followed, so nothing was sent anywhere else. Check kogenticPlanReview.kogentic.baseUrl.`);
    }
    if (res.status === 401 || res.status === 403) throw new ConnectorError(`The API key was rejected (HTTP ${res.status}).`);
    if (!res.ok) throw new ConnectorError(`Kogentic returned HTTP ${res.status}.`);
    const body = (await res.json()) as Partial<SendResult>;
    if (!body || typeof body.plan_id !== 'string') throw new ConnectorError('Unexpected response from Kogentic.');
    return { plan_id: body.plan_id, url: typeof body.url === 'string' ? body.url : undefined };
  } catch (e) {
    if (e instanceof ConnectorError) throw e;
    throw new ConnectorError(`Could not reach Kogentic: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
