import type { ObjetoDeMedicao } from '../../application/portas.ts';
import { escolherCobertura } from '../../domain/cobertura.ts';
import type { ColunaDoEsquema, EntradaSemSelo } from '../../domain/entrada.ts';
import { calcularFrescor } from '../../domain/frescor.ts';
import { fontesVinculadas } from '../../domain/inventario.ts';
import { SAUDE_OK, type ContextoDeDescoberta, type ProvedorDeCatalogo } from '../../domain/provedor.ts';
import { somarDias } from '../../domain/tempo.ts';
import { DESCRICOES_DAS_TABELAS, type DescricaoDaTabela } from '../../dados/descricoes.ts';
import { COLUNAS_DA_SCD2, COLUNAS_DA_VIEW, COLUNAS_INTERNAS, GLOSSARIO_DE_COLUNAS, type DescricaoDeColuna } from '../../dados/glossario.ts';
import { rotuloDaPlataforma, TABELAS_DO_REGISTRO, type TabelaDoRegistro } from '../../dados/registro.ts';
import { RETENCAO_DOS_DADOS, situacaoDasFontes, ultimaColetaOk, resumosPorFonte } from './comum.ts';

const VERSAO = 1;
const ID = 'dados';
const LIMITE_DE_LINHAS_DO_EXEMPLO = 1000;
const MAXIMO_DE_DIMENSOES_NO_EXEMPLO = 3;
const MAXIMO_DE_METRICAS_NO_EXEMPLO = 6;
const COLUNAS_DE_FONTE = new Set([
  'organization_id', 'ad_account_id', 'property_id', 'site', 'channel_id', 'location_id', 'conta_id', 'dataset_id', 'page_id', 'conteiner_id', 'platform',
]);

export function descricaoDaColuna(tabela: string, coluna: string): DescricaoDeColuna | null {
  return DESCRICOES_DAS_TABELAS[tabela]?.colunas?.[coluna] ?? GLOSSARIO_DE_COLUNAS[coluna] ?? null;
}

export function colunasDaTabela(tabela: TabelaDoRegistro, descricao: DescricaoDaTabela | undefined): ColunaDoEsquema[] {
  const base = Object.entries(tabela.tipos)
    .filter(([nome]) => !COLUNAS_INTERNAS.has(nome))
    .map(([nome, tipo]) => ({ nome, tipo }));
  const extras = [
    ...(tabela.tipo === 'scd2' ? COLUNAS_DA_SCD2 : []),
    ...(descricao?.view ? COLUNAS_DA_VIEW : []),
  ];
  return [...base, ...extras].map(({ nome, tipo }) => {
    const significado = descricaoDaColuna(tabela.nome, nome);
    return {
      nome,
      tipo,
      significado: significado?.significado ?? 'Sem descrição cadastrada.',
      unidade: significado?.unidade ?? null,
      anulavel: !tabela.chave.includes(nome) && !['cliente_atual_id', 'atual', 'valido_de', 'valido_ate'].includes(nome),
    };
  });
}

function exemplos(tabela: TabelaDoRegistro, descricao: DescricaoDaTabela, ctx: ContextoDeDescoberta, ate: string) {
  if (!descricao.view) return [];
  const objeto = `\`${ctx.conjuntoDeDados}.${descricao.view}\``;
  const parametros = { cliente_id: ctx.clienteId, desde: somarDias(ate, -29), ate };
  if (tabela.tipo === 'scd2') {
    const colunas = Object.keys(tabela.tipos).filter((c) => !COLUNAS_INTERNAS.has(c)).slice(0, 10);
    return [
      {
        descricao: 'Estado atual das entidades do cliente (versão vigente da dimensão).',
        sql: `SELECT ${colunas.join(', ')}\nFROM ${objeto}\nWHERE cliente_atual_id = @cliente_id\n  AND atual\nLIMIT 500`,
        parametros: { cliente_id: ctx.clienteId },
      },
    ];
  }
  const data = descricao.colunaDeData;
  if (!data) return [];
  const dimensoes = tabela.chave
    .filter((c) => !COLUNAS_DE_FONTE.has(c) && c !== data && tabela.tipos[c] === 'STRING')
    .slice(0, MAXIMO_DE_DIMENSOES_NO_EXEMPLO);
  const metricas = Object.keys(tabela.tipos)
    .filter((c) => descricaoDaColuna(tabela.nome, c)?.agregacao === 'soma')
    .slice(0, MAXIMO_DE_METRICAS_NO_EXEMPLO);
  const agrupamento = [data, ...dimensoes];
  const selecao = [...agrupamento, ...metricas.map((m) => `SUM(${m}) AS ${m}`)];
  return [
    {
      descricao: `Série por ${agrupamento.join(', ')} nos últimos 30 dias do cliente${metricas.length ? ', somando as métricas aditivas' : ''}.`,
      sql: `SELECT ${selecao.join(', ')}\nFROM ${objeto}\nWHERE cliente_atual_id = @cliente_id\n  AND ${data} BETWEEN @desde AND @ate\n${metricas.length ? `GROUP BY ${agrupamento.join(', ')}\n` : ''}ORDER BY ${data}\nLIMIT ${LIMITE_DE_LINHAS_DO_EXEMPLO}`,
      parametros,
    },
  ];
}

function sensibilidadeDa(descricao: DescricaoDaTabela | undefined) {
  const base = descricao?.sensibilidade ?? { nivel: 'negocio' as const, piiPossivel: false, usoPorAgente: 'permitido' as const };
  if (!descricao?.view && base.usoPorAgente === 'permitido') return { ...base, usoPorAgente: 'restrito' as const, retencao: RETENCAO_DOS_DADOS };
  return { ...base, retencao: RETENCAO_DOS_DADOS };
}

function entradaDaTabela(ctx: ContextoDeDescoberta, tabela: TabelaDoRegistro, plataformas: readonly string[]): EntradaSemSelo {
  const descricao = DESCRICOES_DAS_TABELAS[tabela.nome];
  const fontes = fontesVinculadas(ctx.inventario).filter((f) => plataformas.includes(f.platform));
  const situacao = situacaoDasFontes(fontes, ctx.inventario, ctx.agora);
  const medida = ctx.inventario.cobertura.find((m) => m.tabela === tabela.nome);
  const cobertura = escolherCobertura(medida, situacao.janelas, situacao.esperado, ctx.agora);
  const frescor = calcularFrescor({
    dadoAte: cobertura.ate,
    ultimaAtualizacao: ultimaColetaOk(fontes, resumosPorFonte(ctx.inventario)),
    atrasoDias: situacao.atraso,
    agora: ctx.agora,
  });
  const colunas = colunasDaTabela(tabela, descricao);
  const rotulos = plataformas.map(rotuloDaPlataforma).join(' e ');
  const relacionadas = (descricao?.relacionadas ?? []).filter((nome) => TABELAS_DO_REGISTRO.some((t) => t.nome === nome && t.plataformas.some((p) => plataformas.includes(p))));
  const avisos = [
    ...(cobertura.diasFaltando ? [`${cobertura.diasFaltando} dia(s) sem coleta no histórico.`] : []),
    ...(descricao ? [] : ['Tabela sem descrição cadastrada em src/modules/brain/dados/descricoes.ts.']),
    ...(tabela.tipo === 'snapshot' || descricao?.colunaDeData === 'data_snapshot' ? ['Fotografia diária: use o dia mais recente, não some entre dias.'] : []),
  ];
  const view = descricao?.view ?? null;
  return {
    urn: ctx.urn('tabela_de_dados', tabela.nome),
    tipo: 'tabela_de_dados',
    id: tabela.nome,
    titulo: descricao?.titulo ?? tabela.nome,
    descricao: descricao?.descricao ?? `Tabela ${tabela.nome} de ${rotulos}.`,
    provedor: ID,
    plataforma: plataformas.length === 1 ? plataformas[0]! : null,
    referencia: { sistema: 'bigquery', local: `${ctx.conjuntoDeDados}.${view ?? tabela.nome}` },
    esquema: { colunas },
    grao: [...tabela.chave],
    cobertura,
    frescor,
    qualidade: { completude: cobertura.diasEsperados ? Math.min((cobertura.diasComDado ?? 0) / cobertura.diasEsperados, 1) : null, avisos },
    acesso: view
      ? {
          tipo: 'bigquery',
          objeto: view,
          conjuntoDeDados: ctx.conjuntoDeDados,
          filtros: { cliente_atual_id: ctx.clienteId },
          colunaDeData: descricao?.colunaDeData ?? null,
          colunas: colunas.map((c) => c.nome),
          exemplosDeConsulta: descricao ? exemplos(tabela, descricao, ctx, situacao.esperado) : [],
          custoEstimado: {
            bytesMaximosPorConsulta: ctx.bytesMaximosPorConsulta,
            observacao: 'Filtre sempre por cliente_atual_id e pela coluna de data (partição), use LIMIT e maximumBytesBilled.',
          },
        }
      : { tipo: 'externo', sistema: 'bigquery', instrucoes: 'Tabela operacional sem view com dono: não consulte pelo agente.' },
    sensibilidade: sensibilidadeDa(descricao),
    epistemico: null,
    valorResumido: null,
    tags: [
      tabela.tipo === 'scd2' ? 'dimensao' : tabela.tipo,
      ...plataformas.map((p) => `plataforma:${p}`),
      ...(descricao?.tags ?? []),
    ],
    relacoes: [
      ...fontes.map((fonte) => ({ tipo: 'alimentada_por', urn: ctx.urn('fonte', fonte.id) })),
      ...relacionadas.map((nome) => ({ tipo: 'relacionada', urn: ctx.urn('tabela_de_dados', nome) })),
    ],
    versao: VERSAO,
  };
}

export function tabelasDoCliente(plataformasDoCliente: readonly string[], registro: readonly TabelaDoRegistro[] = TABELAS_DO_REGISTRO) {
  return registro
    .map((tabela) => ({ tabela, plataformas: tabela.plataformas.filter((p) => plataformasDoCliente.includes(p)) }))
    .filter(({ plataformas }) => plataformas.length > 0);
}

export function objetosDeMedicao(plataformas: readonly string[]): readonly ObjetoDeMedicao[] {
  return tabelasDoCliente(plataformas).flatMap(({ tabela }) => {
    const descricao = DESCRICOES_DAS_TABELAS[tabela.nome];
    if (!descricao?.view) return [];
    return [{ tabela: tabela.nome, view: descricao.view, colunaDeData: descricao.colunaDeData, dimensao: tabela.tipo === 'scd2' }];
  });
}

export const provedorDeDados: ProvedorDeCatalogo = {
  id: ID,
  versao: VERSAO,
  descricao: 'Tabelas e views do BigQuery que o cliente tem, derivadas do registro de tabelas da coleta, com grão, colunas, cobertura e como consultar.',
  fase: 'primaria',
  tiposDeclarados: ['tabela_de_dados'],
  descobrir(ctx) {
    const plataformas = [...new Set(fontesVinculadas(ctx.inventario).map((f) => f.platform))];
    return tabelasDoCliente(plataformas).map(({ tabela, plataformas: daTabela }) => entradaDaTabela(ctx, tabela, daTabela));
  },
  saude: () => SAUDE_OK,
};
