import { rotaDoCliente } from '../enderecos.ts';
import { renderizarCatalogoMd } from './catalogoMd.ts';
import { frescorPelaColeta } from './frescor.ts';
import type {
  BrainDoCliente,
  Capacidade,
  ColunaDoEsquema,
  EntradaDoBrain,
  Frescor,
  Lacuna,
  ProximaAcao,
} from './tipos.ts';

export const VERSAO_DO_EXEMPLO = 'exemplo-1';
const DIAS = 90;
const HORA = 3_600_000;

export type ContaParaOBrain = {
  readonly platform: string;
  readonly nome: string;
  readonly externalId: string;
  readonly ultimaColeta: Date | null;
  readonly coletaLigada: boolean;
};

export type FonteParaOBrain = { readonly platform: string; readonly nome: string; readonly externalId: string };

export type SecaoParaOBrain = {
  readonly secao: string;
  readonly letra: string;
  readonly titulo: string;
  readonly percentual: number;
};

export type ArquivoParaOBrain = {
  readonly id: string;
  readonly nome: string;
  readonly mime: string;
  readonly tamanhoBytes: number;
  readonly fieldKey: string;
  readonly criadoEm: Date;
};

export type EntradaDoExemplo = {
  readonly clienteId: string;
  readonly clienteNome: string;
  readonly agora: Date;
  readonly contas: readonly ContaParaOBrain[];
  readonly fontes: readonly FonteParaOBrain[];
  readonly completudeGeral: number;
  readonly secoes: readonly SecaoParaOBrain[];
  readonly arquivos: readonly ArquivoParaOBrain[];
};

type ModeloDeTabela = {
  readonly nome: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly grao: string;
  readonly chave: string;
  readonly esquema: readonly ColunaDoEsquema[];
  readonly pii?: boolean;
};

const COL = (nome: string, tipo: string, descricao: string): ColunaDoEsquema => ({ nome, tipo, descricao });
const DIA = COL('data_dia', 'DATE', 'Dia do fato (partição)');
const ORG = COL('organization_id', 'STRING', 'Organização dona do dado');

const TABELAS_POR_PLATAFORMA: Readonly<Record<string, readonly ModeloDeTabela[]>> = {
  meta: [
    {
      nome: 'fato_ads_diario',
      titulo: 'Investimento e resultado por campanha (Meta)',
      descricao: 'Gasto, impressões, cliques, conversões e receita por campanha e dia.',
      grao: 'conta · campanha · dia',
      chave: 'ad_account_id',
      esquema: [ORG, COL('ad_account_id', 'STRING', 'Conta de anúncio'), COL('external_campaign_id', 'STRING', 'Campanha'), DIA, COL('investimento', 'NUMERIC', 'Gasto na moeda da conta'), COL('impressoes', 'INT64', 'Impressões'), COL('cliques', 'INT64', 'Cliques'), COL('conversoes', 'NUMERIC', 'Conversões'), COL('receita', 'NUMERIC', 'Receita atribuída')],
    },
    {
      nome: 'fato_meta_entrega_diaria',
      titulo: 'Entrega por anúncio (Meta)',
      descricao: 'Alcance, frequência e entrega por anúncio e dia.',
      grao: 'conta · anúncio · dia',
      chave: 'ad_account_id',
      esquema: [ORG, COL('ad_account_id', 'STRING', 'Conta'), COL('ad_id', 'STRING', 'Anúncio'), DIA, COL('alcance', 'INT64', 'Pessoas alcançadas'), COL('frequencia', 'FLOAT64', 'Frequência média')],
    },
    {
      nome: 'dim_meta_campanha_scd2',
      titulo: 'Campanhas (Meta, histórico)',
      descricao: 'Nome, objetivo e status de cada campanha, versionados no tempo.',
      grao: 'campanha · versão',
      chave: 'ad_account_id',
      esquema: [ORG, COL('external_campaign_id', 'STRING', 'Campanha'), COL('nome', 'STRING', 'Nome'), COL('objetivo', 'STRING', 'Objetivo'), COL('valido_de', 'TIMESTAMP', 'Início da versão')],
    },
  ],
  google: [
    {
      nome: 'fato_google_campanha_diario',
      titulo: 'Campanhas por dia (Google Ads)',
      descricao: 'Métricas de campanha com parcela de impressões de Pesquisa.',
      grao: 'conta · campanha · dia',
      chave: 'ad_account_id',
      esquema: [ORG, COL('ad_account_id', 'STRING', 'Conta'), COL('external_campaign_id', 'STRING', 'Campanha'), DIA, COL('investimento', 'NUMERIC', 'Custo'), COL('cliques', 'INT64', 'Cliques'), COL('parcela_impressoes_pesquisa', 'FLOAT64', 'Search impression share')],
    },
    {
      nome: 'fato_google_termo_pesquisa_diario',
      titulo: 'Termos de pesquisa (Google Ads)',
      descricao: 'O que as pessoas buscaram antes de clicar no anúncio.',
      grao: 'conta · grupo · termo · dia',
      chave: 'ad_account_id',
      esquema: [ORG, COL('ad_account_id', 'STRING', 'Conta'), COL('termo', 'STRING', 'Termo buscado (até 500)'), DIA, COL('cliques', 'INT64', 'Cliques'), COL('conversoes', 'NUMERIC', 'Conversões')],
    },
  ],
  ga4: [
    {
      nome: 'fato_ga4_aquisicao_diario',
      titulo: 'Aquisição do site (GA4)',
      descricao: 'Sessões, usuários, eventos-chave e receita por fonte, mídia e campanha.',
      grao: 'propriedade · fonte/mídia · dia',
      chave: 'property_id',
      esquema: [ORG, COL('property_id', 'STRING', 'Propriedade'), DIA, COL('fonte', 'STRING', 'sessionSource'), COL('midia', 'STRING', 'sessionMedium'), COL('sessoes', 'INT64', 'Sessões'), COL('eventos_chave', 'NUMERIC', 'Eventos-chave'), COL('receita', 'NUMERIC', 'Receita')],
    },
    {
      nome: 'fato_ga4_pagina_diario',
      titulo: 'Páginas do site (GA4)',
      descricao: 'Visualizações e engajamento por página.',
      grao: 'propriedade · página · dia',
      chave: 'property_id',
      esquema: [ORG, COL('property_id', 'STRING', 'Propriedade'), DIA, COL('pagina', 'STRING', 'pagePath'), COL('visualizacoes', 'INT64', 'Visualizações')],
    },
  ],
  searchconsole: [
    {
      nome: 'fato_search_console_consulta_pagina_diario',
      titulo: 'Busca orgânica (Search Console)',
      descricao: 'Consultas e páginas com cliques, impressões e posição média.',
      grao: 'site · consulta · página · dia',
      chave: 'site',
      esquema: [ORG, COL('site', 'STRING', 'Propriedade'), DIA, COL('consulta', 'STRING', 'Consulta'), COL('pagina', 'STRING', 'Página'), COL('cliques', 'INT64', 'Cliques'), COL('posicao', 'FLOAT64', 'Posição média')],
    },
  ],
  youtube: [
    {
      nome: 'fato_youtube_diario',
      titulo: 'Canal do YouTube',
      descricao: 'Views, minutos assistidos e inscritos por dia.',
      grao: 'canal · dia',
      chave: 'channel_id',
      esquema: [ORG, COL('channel_id', 'STRING', 'Canal'), DIA, COL('views', 'INT64', 'Visualizações'), COL('minutos_assistidos', 'INT64', 'Minutos')],
    },
  ],
  gbp: [
    {
      nome: 'fato_gbp_diario',
      titulo: 'Perfil da Empresa (Google)',
      descricao: 'Interações do perfil: ligações, rotas, cliques no site.',
      grao: 'local · dia',
      chave: 'location_id',
      esquema: [ORG, COL('location_id', 'STRING', 'Local'), DIA, COL('ligacoes', 'INT64', 'Ligações'), COL('rotas', 'INT64', 'Pedidos de rota')],
    },
  ],
  rdstation: [
    {
      nome: 'fato_rd_negociacoes',
      titulo: 'Negociações do CRM (RD Station)',
      descricao: 'Negociações com etapa, valor e origem.',
      grao: 'negociação · versão',
      chave: 'conta',
      esquema: [ORG, COL('negociacao_id', 'STRING', 'Negociação'), COL('etapa', 'STRING', 'Etapa'), COL('valor', 'NUMERIC', 'Valor'), COL('contato_email', 'STRING', 'E-mail do contato (pseudonimizado)')],
      pii: true,
    },
  ],
  leadads: [
    {
      nome: 'fato_meta_leads_diario',
      titulo: 'Leads de formulários (Meta)',
      descricao: 'Leads recebidos por formulário e dia, sem dados pessoais em claro.',
      grao: 'formulário · dia',
      chave: 'form_id',
      esquema: [ORG, COL('form_id', 'STRING', 'Formulário'), DIA, COL('leads', 'INT64', 'Leads')],
      pii: true,
    },
  ],
};

const ROTULO_DO_PROVEDOR: Readonly<Record<string, string>> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  ga4: 'Google Analytics 4',
  searchconsole: 'Search Console',
  youtube: 'YouTube',
  gbp: 'Perfil da Empresa',
  rdstation: 'RD Station',
  leadads: 'Meta Lead Ads',
  gtm: 'Tag Manager',
  pixel: 'Meta Pixel',
};

const EXEMPLOS: readonly ContaParaOBrain[] = [
  { platform: 'meta', nome: 'Conta Meta (exemplo)', externalId: 'act_0000000001', ultimaColeta: null, coletaLigada: true },
  { platform: 'google', nome: 'Conta Google Ads (exemplo)', externalId: '000-000-0001', ultimaColeta: null, coletaLigada: true },
];

function semente(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function sorteador(texto: string): () => number {
  let estado = semente(texto) || 1;
  return () => {
    estado ^= estado << 13;
    estado ^= estado >>> 17;
    estado ^= estado << 5;
    return ((estado >>> 0) % 10_000) / 10_000;
  };
}

export function hashCurto(texto: string): string {
  return semente(texto).toString(16).padStart(8, '0') + semente(`${texto}#`).toString(16).padStart(8, '0');
}

function serie(chave: string, frescor: Frescor, temHistorico: boolean): boolean[] {
  if (!temHistorico) return Array.from({ length: DIAS }, () => false);
  const sortear = sorteador(chave);
  const inicio = Math.floor(sortear() * 30);
  const cauda = frescor === 'fresco' ? 0 : frescor === 'atrasado' ? 3 : frescor === 'parado' ? 18 : DIAS;
  return Array.from({ length: DIAS }, (_, i) => i >= inicio && i < DIAS - cauda && sortear() > 0.06);
}

function diaIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function entradasDaConta(conta: ContaParaOBrain, agora: Date, exemplo: boolean, clienteId: string): EntradaDoBrain[] {
  const sortear = sorteador(`${clienteId}:${conta.externalId}`);
  const ultima = exemplo ? new Date(agora.getTime() - Math.floor(sortear() * 60) * HORA) : conta.ultimaColeta;
  const frescor = conta.coletaLigada ? frescorPelaColeta(ultima, agora) : 'parado';
  const provedor = ROTULO_DO_PROVEDOR[conta.platform] ?? conta.platform;
  const urnConexao = `urn:orla:conexao:${conta.platform}:${conta.externalId}`;
  const tags = exemplo ? ['exemplo', conta.platform] : [conta.platform];

  const conexao: EntradaDoBrain = {
    urn: urnConexao,
    tipo: 'conexao',
    titulo: conta.nome,
    descricao: `${provedor} · ${conta.externalId}${conta.coletaLigada ? '' : ' · coleta pausada'}`,
    provedor: conta.platform,
    esquema: [],
    grao: null,
    cobertura: { desde: null, ate: ultima ? diaIso(ultima) : null, linhas: null, diasComDado: null, ultimos90Dias: null },
    frescor: { status: frescor, ultimaAtualizacao: ultima ? ultima.toISOString() : null },
    qualidade: { completude: conta.coletaLigada ? 1 : 0.5, avisos: conta.coletaLigada ? [] : ['Coleta pausada: o dado para de chegar.'] },
    acesso: { via: 'status', receita: `/integracoes/conector/${conta.platform}` },
    sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido' },
    tags,
    relacoes: [],
  };

  const tabelas = (TABELAS_POR_PLATAFORMA[conta.platform] ?? []).map((modelo): EntradaDoBrain => {
    const dias = serie(`${conta.externalId}:${modelo.nome}`, frescor, Boolean(ultima));
    const comDado = dias.filter(Boolean).length;
    const primeiro = dias.indexOf(true);
    const linhasPorDia = 20 + Math.floor(sortear() * 400);
    const avisos: string[] = [];
    if (comDado > 0 && comDado < DIAS * 0.8) avisos.push(`${DIAS - comDado} dias sem dado nos últimos ${DIAS}.`);
    if (modelo.pii) avisos.push('Pode conter dado pessoal pseudonimizado.');
    return {
      urn: `urn:orla:tabela:${modelo.nome}:${conta.externalId}`,
      tipo: 'tabela_de_dados',
      titulo: modelo.titulo,
      descricao: modelo.descricao,
      provedor: conta.platform,
      esquema: modelo.esquema,
      grao: modelo.grao,
      cobertura: {
        desde: primeiro >= 0 ? diaIso(new Date(agora.getTime() - (DIAS - primeiro) * 24 * HORA)) : null,
        ate: ultima && comDado > 0 ? diaIso(ultima) : null,
        linhas: comDado * linhasPorDia,
        diasComDado: comDado,
        ultimos90Dias: dias,
      },
      frescor: { status: comDado === 0 ? 'desconhecido' : frescor, ultimaAtualizacao: ultima ? ultima.toISOString() : null },
      qualidade: { completude: Math.round((comDado / DIAS) * 100) / 100, avisos },
      acesso: {
        via: 'bigquery',
        receita: `SELECT *\nFROM \`tria_dw.vw_${modelo.nome}\`\nWHERE cliente_atual_id = '${clienteId}'\n  AND ${modelo.chave} = '${conta.externalId}'\n  AND data_dia >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)`,
      },
      sensibilidade: modelo.pii
        ? { nivel: 'restrito', piiPossivel: true, usoPorAgente: 'restrito' }
        : { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido' },
      tags: [...tags, modelo.nome.startsWith('dim_') ? 'dimensão' : 'fato'],
      relacoes: [{ urn: urnConexao, tipo: 'deriva_de' }],
    };
  });

  return [conexao, ...tabelas];
}

function entradasDoContexto(entrada: EntradaDoExemplo): EntradaDoBrain[] {
  return entrada.secoes.map((secao) => ({
    urn: `urn:orla:contexto:${secao.secao}`,
    tipo: 'contexto_secao',
    titulo: `${secao.letra} · ${secao.titulo}`,
    descricao: `Mapa de contexto, seção ${secao.titulo.toLowerCase()}: ${secao.percentual}% preenchido.`,
    provedor: null,
    esquema: [],
    grao: 'campo confirmado',
    cobertura: { desde: null, ate: null, linhas: null, diasComDado: null, ultimos90Dias: null },
    frescor: { status: secao.percentual === 0 ? 'desconhecido' : 'fresco', ultimaAtualizacao: null },
    qualidade: {
      completude: secao.percentual / 100,
      avisos: secao.percentual < 50 ? ['Menos da metade preenchida: o agente vai responder com cautela.'] : [],
    },
    acesso: { via: 'contexto', receita: `brain/${secao.secao}.md` },
    sensibilidade: { nivel: 'negocio', piiPossivel: secao.secao === 'publico', usoPorAgente: 'permitido' },
    tags: ['contexto', secao.secao],
    relacoes: [],
  }));
}

function entradasDeArquivos(entrada: EntradaDoExemplo): EntradaDoBrain[] {
  return entrada.arquivos.map((arquivo) => ({
    urn: `urn:orla:arquivo:${arquivo.id}`,
    tipo: 'arquivo',
    titulo: arquivo.nome,
    descricao: `${arquivo.mime} · ${Math.max(1, Math.round(arquivo.tamanhoBytes / 1024))} KB · campo ${arquivo.fieldKey}`,
    provedor: null,
    esquema: [],
    grao: null,
    cobertura: { desde: diaIso(arquivo.criadoEm), ate: diaIso(arquivo.criadoEm), linhas: null, diasComDado: null, ultimos90Dias: null },
    frescor: { status: 'fresco', ultimaAtualizacao: arquivo.criadoEm.toISOString() },
    qualidade: { completude: 1, avisos: [] },
    acesso: { via: 'arquivo', receita: `arquivos/${arquivo.id}` },
    sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido' },
    tags: ['arquivo', arquivo.fieldKey],
    relacoes: [{ urn: `urn:orla:contexto:${arquivo.fieldKey}`, tipo: 'descreve' }],
  }));
}

function percentualDaSecao(entrada: EntradaDoExemplo, secao: string): number {
  return entrada.secoes.find((s) => s.secao === secao)?.percentual ?? 0;
}

function capacidades(entrada: EntradaDoExemplo, plataformas: ReadonlySet<string>, entradas: readonly EntradaDoBrain[]): Capacidade[] {
  const id = entrada.clienteId;
  const urns = (provedor: string) => entradas.filter((e) => e.tipo === 'tabela_de_dados' && e.provedor === provedor).map((e) => e.urn);
  const temAds = plataformas.has('meta') || plataformas.has('google');
  const ctx = (secao: string) => percentualDaSecao(entrada, secao);

  return [
    {
      id: 'retorno-por-canal',
      pergunta: 'Quanto investimos e qual o retorno por canal?',
      estado: temAds && plataformas.has('ga4') ? 'disponivel' : temAds ? 'parcial' : 'indisponivel',
      evidencias: [...urns('meta'), ...urns('google'), ...urns('ga4')].slice(0, 4),
      falta: [...(temAds ? [] : ['Uma conta de anúncio vinculada']), ...(plataformas.has('ga4') ? [] : ['GA4 para ver o que acontece depois do clique'])],
      acao: plataformas.has('ga4') ? null : { rotulo: 'Conectar GA4', href: '/integracoes/conector/ga4' },
    },
    {
      id: 'termos-que-vendem',
      pergunta: 'Que buscas e campanhas trazem resultado?',
      estado: plataformas.has('google') ? (plataformas.has('searchconsole') ? 'disponivel' : 'parcial') : 'indisponivel',
      evidencias: [...urns('google'), ...urns('searchconsole')].slice(0, 3),
      falta: [...(plataformas.has('google') ? [] : ['Google Ads vinculado']), ...(plataformas.has('searchconsole') ? [] : ['Search Console para a busca orgânica'])],
      acao: plataformas.has('searchconsole') ? null : { rotulo: 'Conectar Search Console', href: '/integracoes/conector/searchconsole' },
    },
    {
      id: 'publico-e-tom',
      pergunta: 'Para quem a marca fala, e com que voz?',
      estado: ctx('publico') >= 60 && ctx('marca') >= 60 ? 'disponivel' : ctx('publico') + ctx('marca') > 0 ? 'parcial' : 'indisponivel',
      evidencias: ['urn:orla:contexto:publico', 'urn:orla:contexto:marca'],
      falta: [...(ctx('publico') >= 60 ? [] : ['Personas (seção C)']), ...(ctx('marca') >= 60 ? [] : ['Tom de voz e posicionamento (seção E)'])],
      acao: ctx('publico') >= 60 ? null : { rotulo: 'Preencher personas', href: rotaDoCliente(id, 'contexto', { secao: 'publico' }) },
    },
    {
      id: 'produtos-prioritarios',
      pergunta: 'Quais produtos empurrar agora?',
      estado: ctx('produtos') >= 60 ? (temAds ? 'disponivel' : 'parcial') : ctx('produtos') > 0 ? 'parcial' : 'indisponivel',
      evidencias: ['urn:orla:contexto:produtos', ...urns('ga4').slice(0, 1)],
      falta: ctx('produtos') >= 60 ? [] : ['Catálogo de produtos com papel e margem (seção B)'],
      acao: ctx('produtos') >= 60 ? null : { rotulo: 'Cadastrar produtos', href: rotaDoCliente(id, 'contexto', { secao: 'produtos' }) },
    },
    {
      id: 'funil-comercial',
      pergunta: 'Onde o lead trava entre o anúncio e a venda?',
      estado: plataformas.has('rdstation') ? 'disponivel' : ctx('comercial') >= 50 ? 'parcial' : 'indisponivel',
      evidencias: [...urns('rdstation'), 'urn:orla:contexto:comercial'],
      falta: plataformas.has('rdstation') ? [] : ['CRM conectado (RD Station)'],
      acao: plataformas.has('rdstation') ? null : { rotulo: 'Conectar RD Station', href: '/integracoes/conector/rdstation' },
    },
  ];
}

function acoes(entrada: EntradaDoExemplo, plataformas: ReadonlySet<string>, entradas: readonly EntradaDoBrain[]): ProximaAcao[] {
  const id = entrada.clienteId;
  const lista: ProximaAcao[] = [];
  const parados = entradas.filter((e) => e.tipo === 'conexao' && (e.frescor.status === 'parado' || e.frescor.status === 'atrasado'));
  for (const parado of parados.slice(0, 2)) {
    lista.push({
      id: `retomar-${parado.urn}`,
      titulo: `Destravar a coleta de ${parado.titulo}`,
      porque: 'Dado atrasado deixa toda resposta sobre investimento desatualizada.',
      impacto: 3,
      href: rotaDoCliente(id, 'conexoes'),
      rotulo: 'Ver dados',
    });
  }
  if (!plataformas.has('ga4')) {
    lista.push({ id: 'conectar-ga4', titulo: 'Conectar o GA4', porque: 'Sem GA4 o Brain não vê o que acontece depois do clique.', impacto: 3, href: '/integracoes/conector/ga4', rotulo: 'Conectar' });
  }
  for (const secao of entrada.secoes) {
    if (secao.percentual >= 60) continue;
    const impacto: 1 | 2 | 3 = ['empresa', 'produtos', 'publico'].includes(secao.secao) ? 3 : ['marca', 'objetivos'].includes(secao.secao) ? 2 : 1;
    lista.push({
      id: `contexto-${secao.secao}`,
      titulo: `Completar ${secao.letra} · ${secao.titulo}`,
      porque: `Está em ${secao.percentual}%. Cada seção completa vira resposta melhor.`,
      impacto,
      href: rotaDoCliente(id, 'contexto', { secao: secao.secao }),
      rotulo: 'Preencher',
    });
  }
  if (!entrada.arquivos.some((a) => a.fieldKey.includes('manual') || a.fieldKey.includes('logo'))) {
    lista.push({ id: 'manual-de-marca', titulo: 'Enviar manual de marca e logo', porque: 'Arquivos de marca dão referência visual e de tom.', impacto: 1, href: rotaDoCliente(id, 'contexto', { secao: 'marca' }), rotulo: 'Enviar' });
  }
  return lista.sort((a, b) => b.impacto - a.impacto).slice(0, 8);
}

function lacunas(entrada: EntradaDoExemplo, plataformas: ReadonlySet<string>): Lacuna[] {
  const id = entrada.clienteId;
  const lista: Lacuna[] = [];
  for (const [plataforma, rotulo] of [['ga4', 'GA4'], ['searchconsole', 'Search Console'], ['rdstation', 'CRM']] as const) {
    if (!plataformas.has(plataforma)) lista.push({ agrupamento: 'conexoes', rotulo, href: `/integracoes/conector/${plataforma}` });
  }
  for (const secao of entrada.secoes) {
    if (secao.percentual === 0) lista.push({ agrupamento: 'contexto', rotulo: `${secao.letra} · ${secao.titulo}`, href: rotaDoCliente(id, 'contexto', { secao: secao.secao }) });
  }
  if (entrada.arquivos.length === 0) lista.push({ agrupamento: 'arquivos', rotulo: 'Manual de marca', href: rotaDoCliente(id, 'contexto', { secao: 'marca' }) });
  return lista;
}

const PESO_DO_FRESCOR: Record<Frescor, number> = { fresco: 1, atrasado: 0.5, parado: 0, desconhecido: 0 };

export function montarBrainDeExemplo(entrada: EntradaDoExemplo): BrainDoCliente {
  const usaExemplo = entrada.contas.length === 0 && entrada.fontes.length === 0;
  const contas: { conta: ContaParaOBrain; exemplo: boolean }[] = usaExemplo
    ? EXEMPLOS.map((conta) => ({ conta, exemplo: true }))
    : [
        ...entrada.contas.map((conta) => ({ conta, exemplo: false })),
        ...entrada.fontes.map((fonte) => ({
          conta: { ...fonte, ultimaColeta: null, coletaLigada: true },
          exemplo: true,
        })),
      ];

  const entradas = [
    ...contas.flatMap(({ conta, exemplo }) => entradasDaConta(conta, entrada.agora, exemplo, entrada.clienteId)),
    ...entradasDoContexto(entrada),
    ...entradasDeArquivos(entrada),
  ];
  const plataformas = new Set(contas.map(({ conta }) => conta.platform));
  const tabelas = entradas.filter((e) => e.tipo === 'tabela_de_dados');
  const cobertura = tabelas.length === 0 ? 0 : Math.round((tabelas.reduce((s, t) => s + (t.cobertura.diasComDado ?? 0), 0) / (tabelas.length * DIAS)) * 100);
  const conexoes = entradas.filter((e) => e.tipo === 'conexao');
  const frescor = conexoes.length === 0 ? 0 : Math.round((conexoes.reduce((s, c) => s + PESO_DO_FRESCOR[c.frescor.status], 0) / conexoes.length) * 100);
  const completudeDoContexto = entrada.completudeGeral;
  const saude = Math.round(cobertura * 0.35 + frescor * 0.35 + completudeDoContexto * 0.3);

  const base = {
    origem: 'exemplo' as const,
    versao: VERSAO_DO_EXEMPLO,
    hash: hashCurto(entradas.map((e) => `${e.urn}:${e.frescor.status}:${e.qualidade.completude}`).join('|')),
    atualizadoEm: entrada.agora.toISOString(),
    pulso: { saude, cobertura, frescor, completudeDoContexto },
    entradas,
    capacidades: capacidades(entrada, plataformas, entradas),
    acoes: acoes(entrada, plataformas, entradas),
    lacunas: lacunas(entrada, plataformas),
  };
  return { ...base, catalogoMd: renderizarCatalogoMd(entrada.clienteNome, base) };
}
