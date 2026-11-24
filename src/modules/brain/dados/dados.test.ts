import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

await import('../testes/ganchos.ts');
const { DESCRICOES_DAS_TABELAS } = await import('./descricoes.ts');
const { GLOSSARIO_DE_REGRAS } = await import('./glossario.ts');
const { DESCRICOES_DOS_TIPOS_DE_REGRAS } = await import('./descricoes.ts');
const { GLOSSARIO_DE_COLUNAS, COLUNAS_DA_SCD2, COLUNAS_DA_VIEW, COLUNAS_INTERNAS } = await import('./glossario.ts');
const { TABELAS_DO_REGISTRO, CONECTORES_POSSIVEIS } = await import('./registro.ts');
const { DEFINICOES_DE_CAPACIDADES } = await import('./capacidades.ts');
const { validarDefinicoes } = await import('../domain/capacidades.ts');
const { descricaoDaColuna } = await import('../infrastructure/provedores/dados.ts');

const DIR_BQ = resolve(process.cwd(), 'scripts/bq');
const ddl = readdirSync(DIR_BQ).filter((n) => n.endsWith('.sql')).map((n) => readFileSync(resolve(DIR_BQ, n), 'utf8')).join('\n');
const views = new Map([...ddl.matchAll(/CREATE OR REPLACE VIEW `\{\{DATASET\}\}\.(vw_\w+)` AS[\s\S]*?FROM `\{\{DATASET\}\}\.(\w+)`/g)].map((m) => [m[1]!, m[2]!]));
type Entidade = { dimensao: string };
type Manifesto = { tabela: string; data?: string; momento?: string; todoPeriodo?: true; entidades?: Entidade[] };
const manifestos = readdirSync(resolve(DIR_BQ, 'manifesto'))
  .filter((n) => n.endsWith('.json'))
  .flatMap((n) => JSON.parse(readFileSync(resolve(DIR_BQ, 'manifesto', n), 'utf8')) as Manifesto[]);

describe('descrições das tabelas (o que o agente lê)', () => {
  it('toda tabela do registro da coleta tem descrição', () => {
    const faltando = TABELAS_DO_REGISTRO.map((t) => t.nome).filter((nome) => !DESCRICOES_DAS_TABELAS[nome]);
    assert.deepEqual(faltando, []);
  });

  it('não há descrição para tabela que saiu do registro', () => {
    const noRegistro = new Set(TABELAS_DO_REGISTRO.map((t) => t.nome));
    assert.deepEqual(Object.keys(DESCRICOES_DAS_TABELAS).filter((nome) => !noRegistro.has(nome)), []);
  });

  it('toda coluna de toda tabela tem significado (glossário ou específico)', () => {
    const faltando: string[] = [];
    for (const tabela of TABELAS_DO_REGISTRO) {
      const colunas = [
        ...Object.keys(tabela.tipos).filter((c) => !COLUNAS_INTERNAS.has(c)),
        ...(tabela.tipo === 'scd2' ? COLUNAS_DA_SCD2.map((c) => c.nome) : []),
        ...COLUNAS_DA_VIEW.map((c) => c.nome),
      ];
      for (const coluna of colunas) if (!descricaoDaColuna(tabela.nome, coluna)) faltando.push(`${tabela.nome}.${coluna}`);
    }
    assert.deepEqual(faltando, []);
  });

  it('a view declarada existe no DDL e lê a própria tabela', () => {
    for (const [nome, descricao] of Object.entries(DESCRICOES_DAS_TABELAS)) {
      if (!descricao.view) continue;
      assert.equal(views.get(descricao.view), nome, `${nome}: view ${descricao.view}`);
    }
  });

  it('a coluna de data bate com o recorte do manifesto de expurgo', () => {
    for (const entrada of manifestos) {
      const descricao = DESCRICOES_DAS_TABELAS[entrada.tabela];
      if (!descricao) continue;
      if (entrada.todoPeriodo) assert.equal(descricao.colunaDeData, null, entrada.tabela);
      else assert.equal(descricao.colunaDeData, entrada.data ?? entrada.momento, entrada.tabela);
    }
  });

  it('entidades do manifesto aparecem como relacionadas do fato', () => {
    const faltando: string[] = [];
    for (const entrada of manifestos) {
      const relacionadas = new Set(DESCRICOES_DAS_TABELAS[entrada.tabela]?.relacionadas ?? []);
      for (const entidade of entrada.entidades ?? []) {
        if (entidade.dimensao !== entrada.tabela && !relacionadas.has(entidade.dimensao)) faltando.push(`${entrada.tabela} -> ${entidade.dimensao}`);
      }
    }
    assert.deepEqual([...new Set(faltando)], []);
  });

  it('descrições são curtas, em uma ou duas frases, sem dado pessoal', () => {
    for (const [nome, d] of Object.entries(DESCRICOES_DAS_TABELAS)) {
      assert.ok(d.descricao.length >= 30 && d.descricao.length <= 400, nome);
      assert.ok(d.titulo.length <= 160, nome);
      assert.ok(!/@/.test(d.descricao), nome);
    }
    for (const [nome, d] of Object.entries(GLOSSARIO_DE_COLUNAS)) assert.ok(d.significado.length <= 400, nome);
  });
});

describe('capacidades declarativas', () => {
  it('definições válidas e só com tabelas que existem no registro', () => {
    assert.deepEqual(validarDefinicoes(DEFINICOES_DE_CAPACIDADES, new Set(TABELAS_DO_REGISTRO.map((t) => t.nome))), []);
  });

  it('catálogo de conectores cobre todas as plataformas com rótulo e para que serve', () => {
    assert.ok(CONECTORES_POSSIVEIS.length >= 10);
    for (const c of CONECTORES_POSSIVEIS) assert.ok(c.rotulo && c.paraQueServe, c.plataforma);
  });
});

describe('vocabulário de regras, limites e decisões', () => {
  it('o glossário cobre os termos do ADR 0051 em frases curtas', () => {
    for (const termo of ['limite', 'regra', 'decisao', 'vigente', 'superada', 'proposta', 'forca', 'origem']) {
      const texto = GLOSSARIO_DE_REGRAS[termo];
      assert.ok(texto && texto.length >= 20 && texto.length <= 400, termo);
    }
  });

  it('todo tipo de entrada de regras tem título e descrição, sem dado pessoal', () => {
    assert.deepEqual(Object.keys(DESCRICOES_DOS_TIPOS_DE_REGRAS).sort(), ['decisao', 'limite', 'regra']);
    for (const [tipo, d] of Object.entries(DESCRICOES_DOS_TIPOS_DE_REGRAS)) {
      assert.ok(d.titulo.length <= 160 && d.descricao.length >= 30 && d.descricao.length <= 400 && !/@/.test(d.descricao), tipo);
    }
  });

  it('a capacidade planejar_com_limites existe e só pede o requisito de limites essenciais', () => {
    const capacidade = DEFINICOES_DE_CAPACIDADES.find((c) => c.id === 'planejar_com_limites');
    assert.deepEqual(capacidade?.requisitos.map((r) => r.tipo), ['limites_essenciais']);
  });
});
