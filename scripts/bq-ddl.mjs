import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { lerArgumentos, resolverAlvo } from './lib/alvoDoBigQuery.mjs';

const USO = `uso:
  node scripts/bq-ddl.mjs --projeto <projeto> --dataset <dataset> [--dry-run] [--confirmar]
  node scripts/bq-ddl.mjs --prod [--dry-run] [--confirmar]

Aplica os arquivos .sql de scripts/bq, em ordem de nome, no dataset escolhido. Não há alvo padrão.
--projeto, --dataset  alvo explícito
--prod                atalho para tria-platform.tria_dw (produção)
--dry-run             só valida cada arquivo com "bq query --dry_run"; não altera nada
--confirmar           obrigatório para aplicar em produção (por --prod ou pelo alvo explícito)
-h, --ajuda, --help   mostra esta ajuda e sai sem tocar em nada`;

const DIR = 'scripts/bq';

const valores = lerArgumentos(
  process.argv.slice(2),
  { 'dry-run': { type: 'boolean', default: false }, confirmar: { type: 'boolean', default: false } },
  USO,
);
const alvo = resolverAlvo(valores, USO);
const ensaio = valores['dry-run'];
const destino = `${alvo.projeto}.${alvo.dataset}`;

console.log(`alvo: ${destino}${alvo.ehProducao ? ' (PRODUÇÃO)' : ''}${ensaio ? ' — dry run, nada é alterado' : ''}`);

if (alvo.ehProducao && !ensaio && !valores.confirmar) {
  console.error('Produção exige --confirmar. Nada foi aplicado.');
  process.exit(1);
}

const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

for (const file of files) {
  const sql = readFileSync(join(DIR, file), 'utf8').replaceAll('{{DATASET}}', destino);
  process.stdout.write(`${ensaio ? 'validando' : 'aplicando'} ${file} ... `);
  const argumentos = ['query', '--project_id', alvo.projeto, '--use_legacy_sql=false', '--format=none'];
  if (ensaio) argumentos.push('--dry_run');
  try {
    execFileSync('bq', [...argumentos, sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('ok');
  } catch (error) {
    console.log('falhou');
    console.error(error.stderr?.toString() || error.message);
    process.exit(1);
  }
}

console.log(`${files.length} arquivo(s) de DDL ${ensaio ? 'validado(s)' : 'aplicado(s)'} em ${destino}.`);
