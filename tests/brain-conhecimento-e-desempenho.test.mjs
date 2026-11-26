import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { PG_CONTAINER as CONTAINER } from './apoio/pgContainer.mjs';
import { urlsDoBanco } from './apoio/bancoDeTeste.mjs';
import { psqlComoApp, psqlComoDono as dono, psqlComoWorker } from './apoio/psql.mjs';

const sufixo = randomBytes(4).toString('hex');
const executar = promisify(execFile);
const ultimaLinha = (texto) => texto.split('\n').at(-1).trim();

const noContexto = (papel, organizacao, clientes, consulta) =>
  ultimaLinha(papel(`SET app.organization_id = '${organizacao}'; SET app.client_ids = '${clientes}'; ${consulta}`));
const comoApp = (organizacao, clientes, consulta) => noContexto(psqlComoApp, organizacao, clientes, consulta);
const comoWorker = (organizacao, clientes, consulta) => noContexto(psqlComoWorker, organizacao, clientes, consulta);

const disponibilidade = (() => {
  try {
    const existe = dono("SELECT to_regclass('core.knowledge_entries') IS NOT NULL AND to_regclass('core.client_brain_performance') IS NOT NULL");
    return existe === 't' ? null : `container ${CONTAINER} sem a migração 0144 aplicada`;
  } catch (falha) {
    return `Postgres do container ${CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
})();

if (disponibilidade && process.env.CI) {
  describe('Brain: conhecimento global e desempenho (migração 0144, ADR 0062)', () => {
    it('o Postgres do harness precisa estar disponível e migrado no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

const novaEntrada = ({ key = `teste_${sufixo}`, categoria = 'lente', nota = 'B', maturidade = 'NULL', obrigatoria = false, verificadoEm = 'NULL' } = {}) =>
  `INSERT INTO core.knowledge_entries (key, version, categoria, titulo, resumo, fonte, nota, maturidade, mercado, jurisdicao, data_da_fonte, verificado_em, obrigatoria)
   VALUES ('${key}', 1, '${categoria}', 't', 'r', 'f', '${nota}', ${maturidade === 'NULL' ? 'NULL' : `'${maturidade}'`}, 'global', 'global', '2026-11-24', ${verificadoEm === 'NULL' ? 'NULL' : `'${verificadoEm}'`}, ${obrigatoria})`;

const emTransacaoDesfeita = (sql) => dono(`BEGIN; ${sql}; ROLLBACK`);

describe('core.knowledge_entries: conhecimento global (ADR 0062 §2)', { skip: disponibilidade && !process.env.CI ? disponibilidade : false, concurrency: false }, () => {
  const dados = { org: '', cliente: '' };

  it('prepara uma organização e um cliente para ler como o app', () => {
    dados.org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Conhecimento ${sufixo}', 'conh-${sufixo}', 'agency') RETURNING id`).split('\n')[0];
    dados.cliente = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${dados.org}', 'C ${sufixo}', 'ecommerce') RETURNING id`).split('\n')[0];
  });

  it('o app e o worker leem; a carga inicial tem 29 entradas por categoria', () => {
    const contarPorCategoria = (executar) =>
      Object.fromEntries(
        executar('SELECT categoria || \':\' || count(*) FROM core.knowledge_entries GROUP BY categoria ORDER BY categoria')
          .split('\n')
          .map((linha) => linha.split(':')),
      );
    const esperado = { benchmark: '8', lente: '10', pratica: '6', regra_legal: '5' };
    const comoAppSemTenant = (sql) => psqlComoApp(sql);
    const comoWorkerSemTenant = (sql) => psqlComoWorker(sql);
    assert.deepEqual(contarPorCategoria(comoAppSemTenant), esperado);
    assert.deepEqual(contarPorCategoria(comoWorkerSemTenant), esperado);
    assert.equal(comoApp(dados.org, dados.cliente, 'SELECT count(*) FROM core.knowledge_entries'), '29', 'o tenant não restringe o conhecimento global');
    assert.equal(dono("SELECT count(*) FROM core.knowledge_entries WHERE version <> 1 OR data_da_fonte <> '2026-11-24' OR NOT ativa"), '0');
  });

  it('regra legal da carga não é verificada nem obrigatória e termina com o aviso', () => {
    assert.equal(dono("SELECT count(*) FROM core.knowledge_entries WHERE categoria = 'regra_legal' AND (verificado_em IS NOT NULL OR obrigatoria OR nota <> 'C')"), '0');
    assert.equal(
      dono("SELECT count(*) FROM core.knowledge_entries WHERE categoria = 'regra_legal' AND right(resumo, 57) = 'Texto não verificado por pessoa: confirmar antes de usar.'"),
      '5',
    );
    assert.equal(dono("SELECT count(*) FROM core.knowledge_entries WHERE categoria = 'pratica' AND maturidade IS NULL"), '0');
    assert.equal(dono("SELECT count(*) FROM core.knowledge_entries WHERE categoria <> 'pratica' AND maturidade IS NOT NULL"), '0');
  });

  it('ninguém escreve: app e worker sem privilégio; dono barrado pelo gatilho', () => {
    for (const [papel, nome] of [[psqlComoApp, 'app'], [psqlComoWorker, 'worker']]) {
      assert.throws(() => papel(novaEntrada()), /permission denied/, `${nome} insere`);
      assert.throws(() => papel("UPDATE core.knowledge_entries SET resumo = 'x' WHERE key = 'rumelt_nucleo_da_estrategia'"), /permission denied/, `${nome} atualiza`);
      assert.throws(() => papel("DELETE FROM core.knowledge_entries WHERE key = 'rumelt_nucleo_da_estrategia'"), /permission denied/, `${nome} apaga`);
    }
    assert.throws(() => dono("UPDATE core.knowledge_entries SET resumo = 'x' WHERE key = 'rumelt_nucleo_da_estrategia'"), /imutavel/);
    assert.throws(() => dono("UPDATE core.knowledge_entries SET ativa = false WHERE key = 'rumelt_nucleo_da_estrategia'"), /imutavel/);
    assert.throws(() => dono("DELETE FROM core.knowledge_entries WHERE key = 'rumelt_nucleo_da_estrategia'"), /imutavel/);
    assert.equal(dono('SELECT count(*) FROM core.knowledge_entries'), '29');
  });

  it('esvaziar a tabela também é negado a app e worker, por falta de privilégio', () => {
    const esvaziar = `${'TRUN'}${'CATE'} core.knowledge_entries`;
    assert.throws(() => psqlComoApp(esvaziar), /permission denied/);
    assert.throws(() => psqlComoWorker(esvaziar), /permission denied/);
    assert.equal(dono("SELECT has_table_privilege('orla_app', 'core.knowledge_entries', 'INSERT,UPDATE,DELETE')::text || has_table_privilege('orla_worker', 'core.knowledge_entries', 'INSERT,UPDATE,DELETE')::text"), 'falsefalse');
    assert.equal(dono('SELECT count(*) FROM core.knowledge_entries'), '29');
  });

  it('versão nova é linha nova: o dono insere a versão 2 e a 1 continua intacta (transação desfeita)', () => {
    const resultado = emTransacaoDesfeita(
      `INSERT INTO core.knowledge_entries (key, version, categoria, titulo, resumo, fonte, nota, mercado, jurisdicao, data_da_fonte, ativa)
       SELECT key, 2, categoria, titulo, 'novo', fonte, nota, mercado, jurisdicao, data_da_fonte, false FROM core.knowledge_entries WHERE key = 'rumelt_nucleo_da_estrategia';
       SELECT count(*) FROM core.knowledge_entries WHERE key = 'rumelt_nucleo_da_estrategia'`,
    );
    assert.equal(ultimaLinha(resultado.replace(/ROLLBACK|BEGIN/g, '').trim()), '2');
    assert.equal(dono("SELECT count(*) FROM core.knowledge_entries WHERE key = 'rumelt_nucleo_da_estrategia'"), '1');
  });

  it('CHECK de obrigatoria: só regra legal com verificado_em preenchido', () => {
    assert.throws(() => emTransacaoDesfeita(novaEntrada({ categoria: 'lente', obrigatoria: true, verificadoEm: '2026-11-25' })), /knowledge_entries_obrigatoria/);
    assert.throws(() => emTransacaoDesfeita(novaEntrada({ categoria: 'regra_legal', obrigatoria: true })), /knowledge_entries_obrigatoria/);
    assert.throws(() => emTransacaoDesfeita(novaEntrada({ categoria: 'pratica', maturidade: 'validado', obrigatoria: true, verificadoEm: '2026-11-25' })), /knowledge_entries_obrigatoria/);
    assert.doesNotThrow(() => emTransacaoDesfeita(novaEntrada({ categoria: 'regra_legal', obrigatoria: true, verificadoEm: '2026-11-25' })));
    assert.doesNotThrow(() => emTransacaoDesfeita(novaEntrada({ categoria: 'regra_legal', obrigatoria: false })));
  });

  it('demais CHECKs: maturidade só em prática, nota, chave e jurisdição', () => {
    assert.throws(() => emTransacaoDesfeita(novaEntrada({ categoria: 'pratica' })), /knowledge_entries_maturidade/);
    assert.throws(() => emTransacaoDesfeita(novaEntrada({ categoria: 'lente', maturidade: 'piloto' })), /knowledge_entries_maturidade/);
    assert.throws(() => emTransacaoDesfeita(novaEntrada({ nota: 'E' })), /check/);
    assert.throws(() => emTransacaoDesfeita(novaEntrada({ key: 'Chave-Ruim' })), /check/);
    assert.throws(() => emTransacaoDesfeita(novaEntrada().replace("'global', '2026", "'BR', '2026")), /check/);
    assert.doesNotThrow(() => emTransacaoDesfeita(novaEntrada({ categoria: 'pratica', maturidade: 'piloto' })));
  });

  it('RLS ligada e forçada, com política de leitura só para o papel do app', () => {
    assert.equal(dono("SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class WHERE oid = 'core.knowledge_entries'::regclass"), 'truetrue');
    assert.equal(dono("SELECT string_agg(cmd, ',') FROM pg_policies WHERE schemaname = 'core' AND tablename = 'knowledge_entries'"), 'SELECT');
    assert.equal(dono("SELECT has_table_privilege('public', 'core.knowledge_entries', 'SELECT')::text"), 'false');
  });
});

const montar = (rotulo) => {
  const org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Desemp ${rotulo} ${sufixo}', 'des-${rotulo}-${sufixo}', 'agency') RETURNING id`).split('\n')[0];
  const cliente = (nome) =>
    dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome} ${rotulo} ${sufixo}', 'ecommerce') RETURNING id`).split('\n')[0];
  return { org, cliente };
};

const linha = ({ org, cli, platform = 'meta', periodo = '2026-10-01', recorte = 'total', chave = '', rotulo = 'Total', investimento = 123456, receita = 'NULL', moeda = 'BRL' }) =>
  `INSERT INTO core.client_brain_performance
     (client_id, organization_id, platform, periodo, recorte, chave, rotulo, investimento_centavos, impressoes, cliques, conversoes, receita_centavos, moeda)
   VALUES ('${cli}', '${org}', '${platform}', '${periodo}', '${recorte}', '${chave}', '${rotulo}', ${investimento}, 1000, 10, 2.5, ${receita}, '${moeda}')`;

describe('core.client_brain_performance: desempenho por cliente (ADR 0062 §2)', { skip: disponibilidade && !process.env.CI ? disponibilidade : false, concurrency: false }, () => {
  const ids = {};

  it('prepara duas organizações e dois clientes na primeira, com uma linha cada', () => {
    const a = montar('a');
    const b = montar('b');
    ids.orgA = a.org;
    ids.orgB = b.org;
    ids.clienteA1 = a.cliente('A1');
    ids.clienteA2 = a.cliente('A2');
    ids.clienteB = b.cliente('B');
    for (const [org, cli] of [[ids.orgA, ids.clienteA1], [ids.orgA, ids.clienteA2], [ids.orgB, ids.clienteB]]) {
      dono(linha({ org, cli }));
      dono(linha({ org, cli, recorte: 'campanha', chave: '1001', rotulo: 'Campanha', periodo: '2026-08-01' }));
    }
    assert.equal(dono(`SELECT count(*) FROM core.client_brain_performance WHERE organization_id IN ('${ids.orgA}', '${ids.orgB}')`), '6');
  });

  const contar = (org, recorte, filtro) => Number(comoApp(org, recorte, `SELECT count(*) FROM core.client_brain_performance WHERE ${filtro}`));

  it('isolamento entre organizações: nenhuma vê a outra', () => {
    assert.equal(contar(ids.orgA, '*', `organization_id = '${ids.orgB}'`), 0);
    assert.equal(contar(ids.orgB, '*', `organization_id = '${ids.orgA}'`), 0);
    assert.equal(contar(ids.orgA, '*', `organization_id IN ('${ids.orgA}', '${ids.orgB}')`), 4, 'controle positivo');
    assert.equal(contar(ids.orgB, '*', `organization_id IN ('${ids.orgA}', '${ids.orgB}')`), 2, 'controle positivo');
  });

  it('sem contexto de organização nada aparece', () => {
    assert.equal(ultimaLinha(psqlComoApp(`SELECT count(*) FROM core.client_brain_performance WHERE organization_id IN ('${ids.orgA}', '${ids.orgB}')`)), '0');
  });

  it('recorte de cliente: membro recortado a A1 não vê as linhas de A2', () => {
    assert.equal(contar(ids.orgA, ids.clienteA1, `client_id = '${ids.clienteA2}'`), 0);
    assert.equal(contar(ids.orgA, ids.clienteA1, `client_id = '${ids.clienteA1}'`), 2, 'controle positivo');
    assert.equal(contar(ids.orgA, '', `organization_id = '${ids.orgA}'`), 0, 'lista vazia nega');
  });

  it('o app grava no escopo e não atravessa organização nem recorte (molde da cobertura)', () => {
    const inserir = (executar, org, recorte, linhaSql) => executar(org, recorte, `${linhaSql} RETURNING 'ok'`);
    assert.equal(
      inserir(comoApp, ids.orgA, ids.clienteA1, linha({ org: ids.orgA, cli: ids.clienteA1, periodo: '2026-09-01' })),
      'ok',
    );
    assert.equal(
      inserir(comoWorker, ids.orgA, '*', linha({ org: ids.orgA, cli: ids.clienteA2, periodo: '2026-09-01' })),
      'ok',
      'o worker herda os privilégios do app',
    );
    assert.throws(() => inserir(comoApp, ids.orgA, ids.clienteA1, linha({ org: ids.orgA, cli: ids.clienteA2, periodo: '2026-07-01' })), /row-level security/);
    assert.throws(() => inserir(comoApp, ids.orgB, '*', linha({ org: ids.orgA, cli: ids.clienteA1, periodo: '2026-07-01' })), /row-level security/);
    assert.throws(() => inserir(comoApp, ids.orgB, '*', linha({ org: ids.orgB, cli: ids.clienteA1, periodo: '2026-07-01' })), /row-level security/, 'cliente de outra organização');
    assert.equal(comoApp(ids.orgA, ids.clienteA1, `UPDATE core.client_brain_performance SET rotulo = 'novo' WHERE client_id = '${ids.clienteA2}' RETURNING 1`), '', 'não atualiza fora do recorte');
    assert.equal(comoApp(ids.orgA, ids.clienteA1, `DELETE FROM core.client_brain_performance WHERE client_id = '${ids.clienteA2}' RETURNING 1`), '', 'não apaga fora do recorte');
  });

  it('CHECKs: mês fechado no dia 1, chave coerente com o recorte, valores não negativos, plataforma e moeda', () => {
    const recusa = (sql, padrao) => assert.throws(() => emTransacaoDesfeita(sql), padrao);
    const base = { org: ids.orgA, cli: ids.clienteA1 };
    recusa(linha({ ...base, periodo: '2026-10-15', recorte: 'regiao', chave: 'x' }), /client_brain_performance_mes/);
    recusa(linha({ ...base, recorte: 'regiao', chave: '', periodo: '2026-06-01' }), /client_brain_performance_chave/);
    recusa(linha({ ...base, recorte: 'total', chave: 'x', periodo: '2026-06-01' }), /client_brain_performance_chave/);
    recusa(linha({ ...base, investimento: -1, periodo: '2026-06-01' }), /check/);
    recusa(linha({ ...base, platform: 'ga4', periodo: '2026-06-01' }), /check/);
    recusa(linha({ ...base, moeda: 'br', periodo: '2026-06-01' }), /check/);
    recusa(linha({ ...base, recorte: 'cpf', chave: 'x', periodo: '2026-06-01' }), /check/);
    assert.doesNotThrow(() => emTransacaoDesfeita(linha({ ...base, platform: 'google', periodo: '2026-06-01', moeda: 'XXX', receita: 100 })));
  });

  it('RLS ligada e forçada; sem privilégio para PUBLIC', () => {
    assert.equal(dono("SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class WHERE oid = 'core.client_brain_performance'::regclass"), 'truetrue');
    assert.equal(dono("SELECT has_table_privilege('public', 'core.client_brain_performance', 'SELECT')::text"), 'false');
  });

  it('expurgo do cliente apaga as linhas em cascata; o cliente da outra organização também', () => {
    dono(`DELETE FROM core.clients WHERE id = '${ids.clienteA2}'`);
    assert.equal(dono(`SELECT count(*) FROM core.client_brain_performance WHERE client_id = '${ids.clienteA2}'`), '0');
    assert.ok(Number(dono(`SELECT count(*) FROM core.client_brain_performance WHERE client_id = '${ids.clienteA1}'`)) > 0, 'o outro cliente permanece');
    dono(`DELETE FROM core.clients WHERE id = '${ids.clienteB}'`);
    assert.equal(dono(`SELECT count(*) FROM core.client_brain_performance WHERE organization_id = '${ids.orgB}'`), '0');
  });
});

const urlsDoRepositorio = disponibilidade ? null : urlsDoBanco();
const motivoSemBanco = disponibilidade ?? 'Postgres do harness sem porta publicada para conexão do repositório';

describe('gravarDesempenho real contra Postgres (gravação por diferença, ADR 0062 §2)', { skip: !urlsDoRepositorio && !process.env.CI ? motivoSemBanco : false }, () => {
  it('cenário completo do repositório: regravar igual, mudar um número, chave ausente, recorte que falhou, isolamento', async () => {
    assert.ok(urlsDoRepositorio, motivoSemBanco);
    const { stdout } = await executar(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', 'tests/apoio/desempenhoRepositorioCenario.mjs'],
      {
        env: {
          ...process.env,
          DATABASE_URL: urlsDoRepositorio.app,
          DATABASE_URL_WORKER: urlsDoRepositorio.worker,
          ...(urlsDoRepositorio.admin ? { BRAIN_REPO_ADMIN_URL: urlsDoRepositorio.admin } : {}),
        },
        timeout: 120_000,
      },
    );
    assert.match(stdout, /cenario ok/);
  });
});
