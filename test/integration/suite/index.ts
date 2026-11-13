import * as path from 'node:path';
import { readdirSync } from 'node:fs';

export async function run(): Promise<void> {
  const { default: Mocha } = await import('mocha');
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });
  for (const f of readdirSync(__dirname).filter((f) => f.endsWith('.test.js'))) mocha.addFile(path.join(__dirname, f));
  await mocha.loadFilesAsync();
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} integration test(s) failed`)) : resolve()));
  });
}
