import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tls from 'node:tls';

/**
 * Makes a throwaway self-signed certificate for 127.0.0.1 with openssl, in a
 * temp dir that is removed right away, and trusts it for this test process.
 * Nothing is written to the repo.
 */
export function throwawayCert(): { key: string; cert: string; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'kpr-tls-'));
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1',
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ], { stdio: 'ignore' });
    const key = readFileSync(join(dir, 'k.pem'), 'utf8');
    const cert = readFileSync(join(dir, 'c.pem'), 'utf8');
    const before = tls.getCACertificates('default');
    tls.setDefaultCACertificates([...before, cert]);
    return { key, cert, restore: () => tls.setDefaultCACertificates(before) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
