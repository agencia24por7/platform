import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const dir = mkdtempSync(join(tmpdir(), 'tria-cred-'));
const file = join(dir, 'credential.json');

const credential = [
  {
    id: 'triaWorkerAuth',
    name: 'ORLA · worker token',
    type: 'httpHeaderAuth',
    data: { name: 'Authorization', value: `Bearer ${env.TRIA_WORKER_TOKEN}` },
  },
];

try {
  const remote = '/home/node/credential.json';
  writeFileSync(file, JSON.stringify(credential), { mode: 0o600 });
  execFileSync('docker', ['cp', file, `orla-n8n:${remote}`], { stdio: 'inherit' });
  execFileSync('docker', ['exec', '-u', 'root', 'orla-n8n', 'sh', '-c', `chown node:node ${remote} && chmod 600 ${remote}`], { stdio: 'inherit' });
  execFileSync('docker', ['exec', 'orla-n8n', 'n8n', 'import:credentials', `--input=${remote}`], {
    stdio: 'inherit',
  });
  execFileSync('docker', ['exec', '-u', 'root', 'orla-n8n', 'rm', '-f', remote], { stdio: 'ignore' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('Credencial importada e cifrada no n8n. O arquivo temporário foi apagado dos dois lados.');
