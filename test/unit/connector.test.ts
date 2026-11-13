import * as http from 'node:http';
import * as https from 'node:https';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildChecklist } from '../../src/core/checklist';
import { buildPlanPayload, connectorEnabled, ConnectorError, isRedirect, maskKey, sendPlan, validateBaseUrl } from '../../src/core/connector';
import { parsePlan } from '../../src/core/plan';
import { startMockKogentic } from '../support/mockKogentic';
import { throwawayCert } from '../support/tls';

const plan = parsePlan('# P\n- edit `src/a.ts`\n- tests', '/r/PLAN.md');
const payload = buildPlanPayload(plan, buildChecklist(plan, () => true), { name: 'demo', sha: 'abc' });

describe('connector opt-in', () => {
  it('is off unless explicitly true', () => {
    expect(connectorEnabled(undefined)).toBe(false);
    expect(connectorEnabled(false)).toBe(false);
    expect(connectorEnabled('true')).toBe(false);
    expect(connectorEnabled(1)).toBe(false);
    expect(connectorEnabled(true)).toBe(true);
  });
});

describe('base URL', () => {
  it('has no default', () => {
    expect(() => validateBaseUrl('')).toThrow(/no default/i);
    expect(() => validateBaseUrl(undefined)).toThrow(ConnectorError);
  });
  it('requires https except for localhost', () => {
    expect(validateBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(validateBaseUrl('http://127.0.0.1:4810')).toBe('http://127.0.0.1:4810');
    expect(validateBaseUrl('http://localhost:4810/')).toBe('http://localhost:4810');
    expect(validateBaseUrl('http://[::1]:4810')).toBe('http://[::1]:4810');
    for (const bad of ['http://api.example.com', 'http://10.0.0.1', 'http://127.0.0.1.evil.com', 'http://localhost.evil.com', 'ftp://x', 'file:///etc', 'nope', 'https://u:p@x.com']) {
      expect(() => validateBaseUrl(bad), bad).toThrow(ConnectorError);
    }
  });
});

describe('payload and key', () => {
  it('contains exactly the documented fields', () => {
    expect(Object.keys(payload).sort()).toEqual(['agent', 'body_md', 'checklist', 'files_touched', 'hash', 'repo', 'title']);
    expect(payload.files_touched).toEqual(['src/a.ts']);
    expect(payload.hash).toBe(plan.hash);
  });
  it('masks keys', () => {
    expect(maskKey('kg_1234567890abcd')).toBe('kg_…abcd');
    expect(maskKey('short')).toBe('****');
    expect(maskKey('abcdefghijkl')).toBe('…ijkl');
  });
});

describe('sendPlan against a local mock server', () => {
  it('posts the payload with the bearer key', async () => {
    const mock = await startMockKogentic(4810, 'kg_test_key_0001');
    try {
      const r = await sendPlan('http://127.0.0.1:4810', 'kg_test_key_0001', payload);
      expect(r).toEqual({ plan_id: 'pl_123', url: 'http://127.0.0.1:4810/p/pl_123' });
      expect(mock.received).toHaveLength(1);
      expect(mock.received[0].method).toBe('POST');
      expect(mock.received[0].url).toBe('/v1/plans');
      expect(mock.received[0].headers['content-type']).toBe('application/json');
      expect(JSON.parse(mock.received[0].body)).toEqual(payload);
    } finally {
      await mock.close();
    }
  });
  it('reports a rejected key and unreachable servers', async () => {
    const mock = await startMockKogentic(4811, 'right');
    try {
      await expect(sendPlan('http://127.0.0.1:4811', 'wrong', payload)).rejects.toThrow(/rejected/);
    } finally {
      await mock.close();
    }
    await expect(sendPlan('http://127.0.0.1:4812', 'k', payload)).rejects.toThrow(/Could not reach/);
  });
  it('refuses without a key or with a non-local http URL, without any request', async () => {
    let calls = 0;
    const f = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ plan_id: 'x' }) };
    };
    await expect(sendPlan('http://127.0.0.1:4813', '', payload, f)).rejects.toThrow(/API key/);
    await expect(sendPlan('http://example.com', 'k', payload, f)).rejects.toThrow(/localhost/);
    await expect(sendPlan('', 'k', payload, f)).rejects.toThrow(/no default/i);
    expect(calls).toBe(0);
  });
  it('rejects malformed responses and HTTP errors', async () => {
    const bad = async () => ({ ok: true, status: 200, json: async () => ({}) });
    await expect(sendPlan('https://x.test', 'k', payload, bad)).rejects.toThrow(/Unexpected/);
    const err = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(sendPlan('https://x.test', 'k', payload, err)).rejects.toThrow(/500/);
  });
});

/** A server that records every request it receives. */
async function recorder(port: number): Promise<{ hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const s = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      hits.push(`${req.method} ${req.url} auth=${req.headers.authorization ?? ''} body=${b.length}`);
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end('{"plan_id":"leaked"}');
    });
  });
  await new Promise<void>((r) => s.listen(port, '127.0.0.1', r));
  return { hits, close: () => new Promise((r) => s.close(() => r())) };
}

describe('redirects are never followed', () => {
  let tlsCert: ReturnType<typeof throwawayCert>;
  beforeAll(() => {
    tlsCert = throwawayCert();
  });
  afterAll(() => tlsCert.restore());

  for (const status of [301, 302, 303, 307, 308]) {
    it(`an https URL answering ${status} to http sends nothing to the http server`, async () => {
      const target = await recorder(4815);
      const secure = https.createServer({ key: tlsCert.key, cert: tlsCert.cert }, (req, res) => {
        req.resume();
        req.on('end', () => {
          res.writeHead(status, { location: 'http://127.0.0.1:4815/v1/plans' });
          res.end();
        });
      });
      await new Promise<void>((r) => secure.listen(4814, '127.0.0.1', r));
      try {
        await expect(sendPlan('https://127.0.0.1:4814', 'kg_secret_key_123', payload)).rejects.toThrow(/redirect/i);
        expect(target.hits).toEqual([]);
      } finally {
        await new Promise<void>((r) => secure.close(() => r()));
        await target.close();
      }
    });
  }
  it('the https test server itself is reachable (sanity check for the test above)', async () => {
    const secure = https.createServer({ key: tlsCert.key, cert: tlsCert.cert }, (req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end('{"plan_id":"pl_tls"}');
      });
    });
    await new Promise<void>((r) => secure.listen(4816, '127.0.0.1', r));
    try {
      expect(await sendPlan('https://127.0.0.1:4816', 'k', payload)).toEqual({ plan_id: 'pl_tls', url: undefined });
    } finally {
      await new Promise<void>((r) => secure.close(() => r()));
    }
  });
  it('a redirect to another host sends nothing there', async () => {
    const other = await recorder(4817);
    const first = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(307, { location: 'http://localhost:4817/v1/plans' });
        res.end();
      });
    });
    await new Promise<void>((r) => first.listen(4818, '127.0.0.1', r));
    try {
      await expect(sendPlan('http://127.0.0.1:4818', 'kg_secret_key_123', payload)).rejects.toThrow(/redirect/i);
      expect(other.hits).toEqual([]);
    } finally {
      await new Promise<void>((r) => first.close(() => r()));
      await other.close();
    }
  });
  it('asks fetch not to follow redirects and treats any 3xx as failure', async () => {
    let mode: string | undefined;
    const f = async (_u: string, init: { redirect: string }) => {
      mode = init.redirect;
      return { ok: false, status: 302, json: async () => ({}) };
    };
    await expect(sendPlan('https://x.test', 'k', payload, f)).rejects.toThrow(/redirect/i);
    expect(mode).toBe('manual');
    expect(isRedirect({ status: 0, type: 'opaqueredirect' })).toBe(true);
    expect(isRedirect({ status: 300 })).toBe(true);
    expect(isRedirect({ status: 399 })).toBe(true);
    expect(isRedirect({ status: 200 })).toBe(false);
    expect(isRedirect({ status: 400 })).toBe(false);
  });
});
