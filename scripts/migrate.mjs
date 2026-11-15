import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const DIR = 'db/migrations';
const CONTAINER = 'orla-postgres';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const files = readdirSync(DIR).filter((name) => name.endsWith('.sql')).sort();

for (const file of files) {
  process.stdout.write(`aplicando ${file} ... `);
  try {
    execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', env.POSTGRES_SUPERUSER, '-d', env.POSTGRES_DB, '-v', 'ON_ERROR_STOP=1', '-q'],
      { input: readFileSync(join(DIR, file)), stdio: ['pipe', 'ignore', 'pipe'] },
    );
    console.log('ok');
  } catch (error) {
    console.log('falhou');
    process.stderr.write(String(error.stderr ?? error.message));
    process.exit(1);
  }
}

console.log(`${files.length} migração(ões) aplicada(s).`);
