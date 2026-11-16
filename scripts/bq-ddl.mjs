import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const DIR = 'scripts/bq';
const dataset = process.argv.includes('--dev') ? 'tria_dw_dev' : 'tria_dw';
const projectId = process.env.GCP_PROJECT_ID || 'tria-platform';

const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

for (const file of files) {
  const sql = readFileSync(join(DIR, file), 'utf8').replaceAll('{{DATASET}}', `${projectId}.${dataset}`);
  process.stdout.write(`aplicando ${file} (${dataset}) ... `);
  try {
    execFileSync('bq', ['query', '--project_id', projectId, '--use_legacy_sql=false', '--format=none', sql], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log('ok');
  } catch (error) {
    console.log('falhou');
    console.error(error.stderr?.toString() || error.message);
    process.exit(1);
  }
}

console.log(`${files.length} arquivo(s) de DDL aplicado(s) em ${dataset}.`);
