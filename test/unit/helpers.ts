import * as http from 'node:http';
import * as net from 'node:net';
import { networkInterfaces } from 'node:os';

export interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json(): unknown;
}

export function request(opts: { host?: string; port: number; path?: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: opts.host ?? '127.0.0.1', port: opts.port, path: opts.path ?? '/', method: opts.method ?? 'POST', headers: opts.headers ?? {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) }));
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** A non-loopback IPv4 address of this machine, if any. */
export function externalIPv4(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return undefined;
}

/** Resolves true if a TCP connection to host:port succeeds. */
export function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    s.setTimeout(1500);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
    s.once('timeout', () => {
      s.destroy();
      resolve(false);
    });
  });
}
