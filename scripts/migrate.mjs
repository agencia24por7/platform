import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const resultado = spawnSync('sh', ['infra/compose/migrar.sh'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PG_CONTAINER: 'orla-postgres',
    PG_USER: env.POSTGRES_SUPERUSER,
    PG_DB: env.POSTGRES_DB,
    MIGRACOES_DIR: 'db/migrations',
  },
});

process.exit(resultado.status ?? 1);
