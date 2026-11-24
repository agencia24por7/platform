import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const executar = promisify(execFile);
const banco = process.env.REGRAS_REPO_DATABASE_URL;
const admin = process.env.REGRAS_REPO_ADMIN_URL;
const worker = process.env.REGRAS_MIGRACAO_WORKER_URL;

describe('scripts/regras-migrar-contexto.mjs', () => {
  it('--help imprime o uso sem tocar no banco', async () => {
    const { stdout } = await executar(process.execPath, ['--experimental-strip-types', 'scripts/regras-migrar-contexto.mjs', '--help'], {
      env: { ...process.env, DATABASE_URL: '' },
    });
    assert.match(stdout, /--ensaio/);
    assert.match(stdout, /--aplicar/);
  });

  it('imprime o alvo (sem senha) antes de qualquer consulta, mesmo quando o banco não responde (ADR 0028)', async () => {
    const falha = await executar(
      process.execPath,
      ['--experimental-strip-types', 'scripts/regras-migrar-contexto.mjs', '--org', '00000000-0000-4000-8000-000000000000'],
      { env: { ...process.env, DATABASE_URL: 'postgres://alvo_teste:segredo_nao_impresso@127.0.0.1:1/banco_alvo' }, timeout: 30_000 },
    ).then(
      () => null,
      (erro) => erro,
    );
    assert.ok(falha, 'sem banco o script tem de falhar');
    assert.match(falha.stdout, /^Alvo: 127\.0\.0\.1:1\/banco_alvo \(usuário alvo_teste\)$/m);
    assert.match(falha.stdout, /Modo: ENSAIO/);
    assert.doesNotMatch(`${falha.stdout}${falha.stderr}`, /segredo_nao_impresso/);
    assert.doesNotMatch(falha.stdout, /Banco: /, 'nenhuma consulta respondeu, então nada além do alvo foi impresso');
  });

  it('migra J e K para Regras contra Postgres real (ensaio não grava, reexecução não duplica)', { skip: !banco || !admin || !worker ? 'defina REGRAS_REPO_DATABASE_URL, REGRAS_REPO_ADMIN_URL e REGRAS_MIGRACAO_WORKER_URL de um Postgres descartável migrado' : false }, async () => {
    const { stdout } = await executar(process.execPath, ['--experimental-strip-types', 'tests/apoio/regrasMigracaoCenario.mjs'], {
      env: { ...process.env, DATABASE_URL: banco, REGRAS_REPO_ADMIN_URL: admin, REGRAS_MIGRACAO_WORKER_URL: worker },
      timeout: 180_000,
    });
    assert.match(stdout, /cenario ok/);
  });
});
