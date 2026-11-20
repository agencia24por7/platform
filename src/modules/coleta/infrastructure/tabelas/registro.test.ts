import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as modulo from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TabelasDaPlataforma } from './tipos.ts';
import { colunaDeDataDaChave } from '../sqlDaGravacao.ts';

type Resolver = (especificador: string, contexto: { parentURL?: string }, proximo: (especificador: string, contexto: unknown) => unknown) => unknown;
type ComGanchos = { registerHooks: (ganchos: { resolve: Resolver }) => void };

type Entidade = { coluna: string | string[]; dimensao: string; chaveDim: string | string[] };
type EntradaDoManifesto = {
  tabela: string;
  chave: string;
  plataforma: string;
  data?: string;
  momento?: string;
  todoPeriodo?: true;
  grao?: string[];
  entidades?: Entidade[];
};

const RAIZ = process.cwd();
const DIR_BQ = resolve(RAIZ, 'scripts/bq');

function arquivoTs(base: string): string | null {
  return [base, `${base}.ts`, `${base}/index.ts`].find((candidato) => candidato.endsWith('.ts') && existsSync(candidato)) ?? null;
}

(modulo as unknown as ComGanchos).registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador.startsWith('@/')) {
      const alvo = arquivoTs(resolve(RAIZ, 'src', especificador.slice(2)));
      if (alvo) return proximo(pathToFileURL(alvo).href, contexto);
    }
    if (especificador.startsWith('.') && contexto.parentURL?.endsWith('.ts') && !/\.\w+$/.test(especificador)) {
      const alvo = arquivoTs(resolve(dirname(fileURLToPath(contexto.parentURL)), especificador));
      if (alvo) return proximo(pathToFileURL(alvo).href, contexto);
    }
    return proximo(especificador, contexto);
  },
});

const { TABELAS_POR_PLATAFORMA } = (await import('./index.ts')) as { TABELAS_POR_PLATAFORMA: Record<string, TabelasDaPlataforma> };

const configuracoes = Object.values(TABELAS_POR_PLATAFORMA).flatMap((tabelas) => Object.values(tabelas));
const chaveNoRegistro = new Map<string, readonly string[]>();
for (const cfg of configuracoes) {
  if (cfg.tipo === 'fato') chaveNoRegistro.set(cfg.fato, cfg.chave);
  if (cfg.tipo === 'scd2') chaveNoRegistro.set(cfg.dimensao, cfg.chave);
}

const manifestos = readdirSync(resolve(DIR_BQ, 'manifesto'))
  .filter((nome) => nome.endsWith('.json'))
  .flatMap((nome) => (JSON.parse(readFileSync(resolve(DIR_BQ, 'manifesto', nome), 'utf8')) as EntradaDoManifesto[]).map((entrada) => ({ arquivo: nome, entrada })));

const ddl = readdirSync(DIR_BQ).filter((nome) => nome.endsWith('.sql')).map((nome) => readFileSync(resolve(DIR_BQ, nome), 'utf8')).join('\n');
const objetosDoDdl = new Set([...ddl.matchAll(/CREATE (?:OR REPLACE )?(?:TABLE|VIEW)(?: IF NOT EXISTS)? `\{\{DATASET\}\}\.(\w+)`/g)].map((m) => m[1]!));
const documentados = new Set([...readFileSync(resolve(DIR_BQ, 'README.md'), 'utf8').matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]!));

const lista = (valor: string | string[]) => (Array.isArray(valor) ? valor : [valor]);

describe('registro de tabelas x manifesto', () => {
  it('toda entrada do manifesto declara o grão e ele é a chave do MERGE no registro', () => {
    for (const { arquivo, entrada } of manifestos) {
      assert.ok(entrada.grao && entrada.grao.length > 0, `${arquivo}: ${entrada.tabela} sem grao`);
      assert.ok(entrada.grao.includes('organization_id'), `${arquivo}: ${entrada.tabela} grao sem organization_id`);
      const chave = chaveNoRegistro.get(entrada.tabela);
      if (chave) assert.deepEqual(entrada.grao, [...chave], `${arquivo}: ${entrada.tabela}`);
    }
  });

  it('toda tabela gravada pelo registro está em algum manifesto (exclusão de cliente)', () => {
    const noManifesto = new Set(manifestos.map(({ entrada }) => entrada.tabela));
    for (const tabela of chaveNoRegistro.keys()) assert.ok(noManifesto.has(tabela), `${tabela} fora do manifesto`);
  });

  it('entrada segue o formato do titular.mjs (um recorte de período)', () => {
    for (const { arquivo, entrada } of manifestos) {
      const recortes = [entrada.data !== undefined, entrada.momento !== undefined, entrada.todoPeriodo === true].filter(Boolean);
      assert.equal(recortes.length, 1, `${arquivo}: ${entrada.tabela}`);
      assert.ok(entrada.grao!.includes(entrada.chave), `${arquivo}: ${entrada.tabela} grao sem a chave da fonte`);
    }
  });

  it('entidades apontam para uma dimensão do manifesto e usam a chave dela', () => {
    const graoPorTabela = new Map(manifestos.map(({ entrada }) => [entrada.tabela, entrada.grao ?? []]));
    for (const { arquivo, entrada } of manifestos) {
      for (const entidade of entrada.entidades ?? []) {
        const graoDaDim = graoPorTabela.get(entidade.dimensao);
        assert.ok(graoDaDim, `${arquivo}: ${entrada.tabela} -> ${entidade.dimensao} inexistente`);
        assert.equal(lista(entidade.coluna).length, lista(entidade.chaveDim).length, `${arquivo}: ${entrada.tabela}`);
        for (const coluna of lista(entidade.chaveDim)) assert.ok(graoDaDim.includes(coluna), `${entidade.dimensao} sem ${coluna}`);
      }
    }
  });

  it('todo fato tem organization_id e exatamente uma coluna de data na chave (filtro constante do MERGE)', () => {
    for (const cfg of configuracoes) {
      if (cfg.tipo !== 'fato') continue;
      assert.ok(cfg.chave.includes('organization_id'), cfg.fato);
      assert.ok(colunaDeDataDaChave(cfg), cfg.fato);
    }
  });

  it('dimensão nula da chave vira (not set), senão o MERGE nunca casa e o reprocesso duplica', () => {
    const ctx = { organizationId: 'o', clientId: 'c', externalId: 'f', currency: 'BRL', execucaoId: 'e' };
    assert.equal(TABELAS_POR_PLATAFORMA.ga4!.padrao!.mapear({ metricDate: '2026-11-01' }, ctx).canal, '(not set)');
    assert.equal(TABELAS_POR_PLATAFORMA.searchconsole!.padrao!.mapear({ metricDate: '2026-11-01', device: null }, ctx).device, '(not set)');
  });

  it('snapshot do GTM grava a execução, que entra na chave do MERGE idempotente', () => {
    const ctx = { organizationId: 'o', clientId: 'c', externalId: 'f', currency: 'BRL', execucaoId: 'e' };
    const snapshot = TABELAS_POR_PLATAFORMA.gtm!.padrao!;
    assert.equal(snapshot.tipo, 'snapshot');
    assert.equal(snapshot.mapear({}, ctx).execucao_id, 'e');
    assert.ok(snapshot.tipo === 'snapshot' && snapshot.chave.every((coluna) => coluna in snapshot.tipos));
  });

  it('fatos gravam execucao_id e inserido_em (o MERGE filtra o lote por eles)', () => {
    for (const cfg of configuracoes) {
      if (cfg.tipo !== 'fato') continue;
      assert.ok(cfg.colunas.includes('execucao_id') && cfg.colunas.includes('inserido_em'), cfg.fato);
    }
  });
});

describe('DDL x README', () => {
  it('toda tabela e view do DDL (fora stg_*) está documentada no README', () => {
    const faltando = [...objetosDoDdl].filter((nome) => !nome.startsWith('stg_') && !documentados.has(nome));
    assert.deepEqual(faltando, []);
  });

  it('toda tabela do manifesto existe no DDL', () => {
    for (const { arquivo, entrada } of manifestos) assert.ok(objetosDoDdl.has(entrada.tabela), `${arquivo}: ${entrada.tabela}`);
  });
});

describe('views vw_* x exclusão lógica de cliente (ADR 0022)', () => {
  const views = [...ddl.matchAll(/CREATE OR REPLACE VIEW `\{\{DATASET\}\}\.(vw_\w+)` AS([\s\S]*?);\n/g)].map((m) => ({ nome: m[1]!, corpo: m[2]! }));

  it('o DDL tem views vw_*', () => {
    assert.ok(views.length > 0);
  });

  it('toda view expõe cliente_atual_status e esconde linha de cliente atual excluído', () => {
    for (const { nome, corpo } of views) {
      assert.ok(corpo.includes('cliente_atual.status AS cliente_atual_status'), `${nome} sem cliente_atual_status`);
      assert.ok(corpo.includes("IFNULL(cliente_atual.status, '') != 'excluido'"), `${nome} sem o filtro do dono atual`);
    }
  });

  it('view com dono na época também esconde linha cujo dono na época foi excluído', () => {
    for (const { nome, corpo } of views.filter((view) => view.corpo.includes('cliente_epoca'))) {
      assert.ok(corpo.includes('cliente_epoca.status AS cliente_na_epoca_status'), `${nome} sem cliente_na_epoca_status`);
      assert.ok(corpo.includes("IFNULL(cliente_epoca.status, '') != 'excluido'"), `${nome} sem o filtro do dono na época`);
    }
  });
});
