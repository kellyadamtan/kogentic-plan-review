// Lists a .vsix and fails if it contains anything that should not ship:
// sources, tests, node_modules, secrets or files over the size budget.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-vsix.mjs <file.vsix>');
  process.exit(2);
}
const MAX_BYTES = 2 * 1024 * 1024;
const size = statSync(file).size;
// The .vsix is a zip; `unzip -Z1` lists entries without extracting.
const entries = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n');
const forbidden = [
  /^extension\/src\//,
  /^extension\/test\//,
  /^extension\/out\//,
  /^extension\/node_modules\//,
  /^extension\/\.github\//,
  /^extension\/\.vscode-test\//,
  /(^|\/)\.env(\.|$)/,
  /\.(pem|key|p12|pfx)$/,
  /(^|\/)(id_rsa|id_ed25519)$/,
  /\.vsix$/,
  /\.ts$/,
];
const bad = entries.filter((e) => forbidden.some((re) => re.test(e)));
for (const e of entries) console.log(`  ${e}`);
console.log(`${entries.length} entries, ${size} bytes`);
const required = ['extension/package.json', 'extension/dist/extension.js', 'extension/media/icon.png', 'extension/media/review.js', 'extension/media/review.css', 'extension/LICENSE.txt'];
const missing = required.filter((r) => !entries.includes(r));
if (bad.length || missing.length || size > MAX_BYTES) {
  if (bad.length) console.error(`forbidden entries: ${bad.join(', ')}`);
  if (missing.length) console.error(`missing entries: ${missing.join(', ')}`);
  if (size > MAX_BYTES) console.error(`too large: ${size} > ${MAX_BYTES}`);
  process.exit(1);
}
console.log('vsix check: OK');
