import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';

const BANCO = `migrar_teste_${process.pid}`;
const pasta = mkdtempSync(join(tmpdir(), 'migrar-'));

const admin = (sql, banco = BANCO) =>
  execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', banco, '-qtAc', sql], {
    encoding: 'utf8',
  }).trim();

const escrever = (nome, sql) => writeFileSync(join(pasta, nome), sql);

function migrar() {
  const r = spawnSync('sh', ['infra/compose/migrar.sh'], {
    encoding: 'utf8',
    env: { ...process.env, PG_CONTAINER: PG_CONTAINER, PG_USER: 'postgres', PG_DB: BANCO, MIGRACOES_DIR: pasta, SINCRONIZAR_SENHA_WORKER: '0' },
  });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}

const livro = () => admin('SELECT string_agg(nome, \',\' ORDER BY nome) FROM public.schema_migrations');
const existe = (tabela) => admin(`SELECT to_regclass('public.${tabela}') IS NOT NULL`);

describe('migrar.sh: cada migração é atômica com sua linha no livro-razão', () => {
  before(() => {
    admin(`CREATE DATABASE ${BANCO}`, 'postgres');
  });

  after(() => {
    admin(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`, 'postgres');
    rmSync(pasta, { recursive: true, force: true });
  });

  it('falha no meio desfaz o arquivo inteiro e não grava o livro-razão', () => {
    escrever('0001_base.sql', 'BEGIN;\nCREATE TABLE t1 (id int);\nCOMMIT;\n');
    escrever('0002_quebra.sql', 'BEGIN;\nCREATE TABLE t2 (id int);\nINSERT INTO t1 VALUES (1);\nCOMMIT;\nSELECT 1/0;\n');

    const r = migrar();
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /transação desfeita/);
    assert.equal(livro(), '0001_base.sql');
    assert.equal(existe('t2'), 'f');
    assert.equal(admin('SELECT count(*) FROM t1'), '0');
  });

  it('corrigido o arquivo, a nova execução aplica do zero', () => {
    escrever('0002_quebra.sql', 'BEGIN;\nCREATE TABLE t2 (id int);\nINSERT INTO t1 VALUES (1);\nCOMMIT;\nSELECT 1;\n');

    const r = migrar();
    assert.equal(r.status, 0, r.saida);
    assert.equal(livro(), '0001_base.sql,0002_quebra.sql');
    assert.equal(existe('t2'), 't');
    assert.equal(admin('SELECT count(*) FROM t1'), '1');
  });

  it('rodar de novo não reaplica nada', () => {
    const r = migrar();
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /0 migração\(ões\) aplicada\(s\)/);
    assert.equal(admin('SELECT count(*) FROM t1'), '1');
  });

  it('o sufixo .sem_transacao roda fora da transação (CREATE INDEX CONCURRENTLY)', () => {
    escrever('0003_indice.sem_transacao.sql', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS t1_id ON t1 (id);\n');

    const r = migrar();
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /sem transação/);
    assert.equal(admin("SELECT to_regclass('public.t1_id') IS NOT NULL"), 't');
  });

  it('recusa arquivo que controla a transação no meio, sem aplicar nada dele', () => {
    escrever('0004_controle.sql', 'CREATE TABLE t4 (id int);\nROLLBACK;\nCREATE TABLE t5 (id int);\n');

    const r = migrar();
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /controla a transação/);
    assert.equal(existe('t4'), 'f');
    assert.doesNotMatch(livro(), /0004/);
    rmSync(join(pasta, '0004_controle.sql'));
  });

  it('recusa nome fora do padrão', () => {
    escrever('5_sem_numero.sql', 'SELECT 1;\n');
    const r = migrar();
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /fora do padrão/);
    rmSync(join(pasta, '5_sem_numero.sql'));
  });
});
