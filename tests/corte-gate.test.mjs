import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';

const BANCO = `corte_gate_teste_${process.pid}`;
const pasta = mkdtempSync(join(tmpdir(), 'corte-gate-'));
const migracoes = join(pasta, 'migracoes');
const portao = join(pasta, 'corte-gate.txt');
const marca = join(pasta, '.preflight-ok');

const admin = (sql, banco = BANCO) =>
  execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', banco, '-qtAc', sql], { encoding: 'utf8' }).trim();
const escrever = (nome, sql) => writeFileSync(join(migracoes, nome), sql);
const livro = () => admin("SELECT coalesce(string_agg(nome, ',' ORDER BY nome), '') FROM public.schema_migrations");

function migrar(extra = {}) {
  const r = spawnSync('sh', ['infra/compose/migrar.sh'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PG_CONTAINER: PG_CONTAINER,
      PG_USER: 'postgres',
      PG_DB: BANCO,
      MIGRACOES_DIR: migracoes,
      SINCRONIZAR_SENHA_WORKER: '0',
      CORTE_GATE_ARQUIVO: portao,
      PREFLIGHT_MARCA: marca,
      RELEASE_CORTE_AUTORIZADO: '0',
      RELEASE_ID: '',
      ...extra,
    },
  });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}

describe('portão do corte no migrar.sh (release 2026-11)', { concurrency: false }, () => {
  before(() => {
    execFileSync('mkdir', ['-p', migracoes]);
    admin(`CREATE DATABASE ${BANCO}`, 'postgres');
    writeFileSync(portao, '# corte\n0003_corte.sql\n');
    escrever('0001_base.sql', 'BEGIN;\nCREATE TABLE t1 (id int);\nCOMMIT;\n');
  });

  after(() => {
    admin(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`, 'postgres');
    rmSync(pasta, { recursive: true, force: true });
  });

  it('banco novo (livro-razão vazio) aplica tudo sem pedir autorização: não há o que cortar', () => {
    const r = migrar();
    assert.equal(r.status, 0, r.saida);
    assert.equal(livro(), '0001_base.sql');
  });

  it('banco existente com corte pendente e sem autorização: recusa antes da primeira migração', () => {
    escrever('0002_antes.sql', 'BEGIN;\nCREATE TABLE t2 (id int);\nCOMMIT;\n');
    escrever('0003_corte.sql', 'BEGIN;\nDROP TABLE t1;\nCOMMIT;\n');
    escrever('0004_depois.sql', 'BEGIN;\nCREATE TABLE t4 (id int);\nCOMMIT;\n');

    const r = migrar();
    assert.equal(r.status, 3, r.saida);
    assert.match(r.saida, /corte bloqueado: pendentes do corte: 0003_corte\.sql/);
    assert.match(r.saida, /Nenhuma migração foi aplicada/);
    assert.equal(livro(), '0001_base.sql');
    assert.equal(admin("SELECT to_regclass('public.t2') IS NULL"), 't');
  });

  it('o modo listar mostra as pendentes e o corte sem aplicar nada', () => {
    const r = migrar({ MIGRAR_MODO: 'listar' });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /^pendente 0002_antes\.sql$/m);
    assert.match(r.saida, /^pendente \(corte\) 0003_corte\.sql$/m);
    assert.match(r.saida, /^3 migração\(ões\) pendente\(s\)\.$/m);
    assert.match(r.saida, /^corte pendente: 0003_corte\.sql$/m);
    assert.equal(livro(), '0001_base.sql');
  });

  it('autorizado mas sem a marca do pre-flight desta release: recusa', () => {
    writeFileSync(marca, 'outra-release\n');
    const r = migrar({ RELEASE_CORTE_AUTORIZADO: '1', RELEASE_ID: 'abc123' });
    assert.equal(r.status, 3, r.saida);
    assert.match(r.saida, /marca do pre-flight/);
    assert.equal(livro(), '0001_base.sql');
  });

  it('autorizado e com a marca da mesma release: aplica tudo, em ordem', () => {
    writeFileSync(marca, 'abc123\n2026-11-20T10:00:00Z\n');
    const r = migrar({ RELEASE_CORTE_AUTORIZADO: '1', RELEASE_ID: 'abc123' });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /corte autorizado para a release abc123/);
    assert.equal(livro(), '0001_base.sql,0002_antes.sql,0003_corte.sql,0004_depois.sql');
  });

  it('depois do corte aplicado, deploys seguintes não pedem autorização', () => {
    escrever('0005_seguinte.sql', 'BEGIN;\nCREATE TABLE t5 (id int);\nCOMMIT;\n');
    const r = migrar();
    assert.equal(r.status, 0, r.saida);
    assert.match(livro(), /0005_seguinte\.sql$/);
  });

  it('o portão do repositório lista exatamente as migrações do corte, que existem', () => {
    const listadas = readFileSync('db/corte-gate.txt', 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
    assert.deepEqual(listadas, ['0121_corte_para_cofre.sql', '0122_cofre_modo_unico.sql', '0123_remover_legado_do_cofre.sql']);
    for (const nome of listadas) assert.ok(readFileSync(join('db/migrations', nome), 'utf8').length > 0);
  });
});
