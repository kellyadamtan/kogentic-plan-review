import * as http from 'node:http';

export interface Received {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A local stand-in for the Kogentic API, bound to 127.0.0.1. Tests use ports 4810-4819. */
export async function startMockKogentic(port: number, key: string): Promise<{ received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (body += c));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.headers.authorization !== `Bearer ${key}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{"error":"unauthorized"}');
        return;
      }
      if (req.method !== 'POST' || req.url !== '/v1/plans') {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ plan_id: 'pl_123', url: `http://127.0.0.1:${port}/p/pl_123` }));
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return { received, close: () => new Promise((r) => server.close(() => r())) };
}
