import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

const pasta = mkdtempSync(join(tmpdir(), 'bq-falso-'));
const registro = join(pasta, 'chamadas.log');
writeFileSync(join(pasta, 'bq'), `#!/bin/sh\nprintf '%s ' "$@" | tr '\\n' ' ' >> "${registro}"\necho >> "${registro}"\n`);
chmodSync(join(pasta, 'bq'), 0o755);

function rodar(script, args) {
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${pasta}${delimiter}${process.env.PATH}`, PROJETO: 'tria-platform', DATASET: 'tria_dw' },
  });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}

const chamadas = () => (existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean) : []);

const SCRIPTS = ['scripts/bq-ddl.mjs', 'scripts/bq/verificar-integridade.mjs'];

describe('scripts que tocam o BigQuery não têm alvo padrão (ADR 0028)', () => {
  beforeEach(() => rmSync(registro, { force: true }));
  after(() => rmSync(pasta, { recursive: true, force: true }));

  for (const script of SCRIPTS) {
    for (const ajuda of ['--help', '-h', '--ajuda']) {
      it(`${script} ${ajuda} mostra o uso, sai 0 e não chama o bq`, () => {
        const r = rodar(script, [ajuda]);
        assert.equal(r.status, 0, r.saida);
        assert.match(r.saida, /uso:/);
        assert.deepEqual(chamadas(), []);
      });
    }

    it(`${script} sem alvo recusa e não chama o bq (variáveis de ambiente não viram alvo)`, () => {
      const r = rodar(script, []);
      assert.equal(r.status, 2, r.saida);
      assert.match(r.saida, /alvo obrigatório/);
      assert.deepEqual(chamadas(), []);
    });

    it(`${script} com opção desconhecida recusa e não chama o bq`, () => {
      const r = rodar(script, ['--projeto', 'meu-projeto', '--dataset', 'x', '--aplicar-tudo']);
      assert.equal(r.status, 2, r.saida);
      assert.match(r.saida, /uso:/);
      assert.deepEqual(chamadas(), []);
    });
  }

  it('bq-ddl --prod sem --confirmar mostra o alvo e não aplica', () => {
    const r = rodar('scripts/bq-ddl.mjs', ['--prod']);
    assert.equal(r.status, 1, r.saida);
    assert.match(r.saida, /tria-platform\.tria_dw \(PRODUÇÃO\)/);
    assert.match(r.saida, /exige --confirmar/);
    assert.deepEqual(chamadas(), []);
  });

  it('bq-ddl com o alvo de produção explícito também exige --confirmar', () => {
    const r = rodar('scripts/bq-ddl.mjs', ['--projeto', 'tria-platform', '--dataset', 'tria_dw']);
    assert.equal(r.status, 1, r.saida);
    assert.deepEqual(chamadas(), []);
  });

  it('bq-ddl --dry-run valida com --dry_run, inclusive em produção sem --confirmar', () => {
    const r = rodar('scripts/bq-ddl.mjs', ['--prod', '--dry-run']);
    assert.equal(r.status, 0, r.saida);
    const feitas = chamadas();
    assert.ok(feitas.length > 0);
    assert.ok(feitas.every((linha) => linha.includes('--dry_run') && linha.includes('--project_id tria-platform')));
  });

  it('bq-ddl num alvo explícito fora de produção aplica sem --confirmar', () => {
    const r = rodar('scripts/bq-ddl.mjs', ['--projeto', 'meu-projeto', '--dataset', 'tria_dw_dev']);
    assert.equal(r.status, 0, r.saida);
    const feitas = chamadas();
    assert.ok(feitas.length > 0);
    assert.ok(feitas.every((linha) => !linha.includes('--dry_run') && linha.includes('meu-projeto.tria_dw_dev')));
  });
});
