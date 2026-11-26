import { criarUrn } from '../../brain/domain/urn.ts';
import type { PacoteDeLeitura } from './pacote.ts';
import { lerPlano, type Afirmacao, type Evidencia, type PapelDaEvidencia, type Plano } from './plano.ts';
import { parecer } from './comite/fixturesDeParecer.ts';
import { PERSONAS } from './comite/personas.ts';
import type { ContextoDoGate } from './gate/resultado.ts';

export const HOJE = '2026-11-25';
export const ORGANIZACAO_ID = '11111111-1111-4111-8111-111111111111';
export const CLIENTE_ID = '22222222-2222-4222-8222-222222222222';
export const OUTRO_CLIENTE_ID = '33333333-3333-4333-8333-333333333333';

export const urnDeTeste = (tipo: string, id: string): string => criarUrn(ORGANIZACAO_ID, CLIENTE_ID, tipo, id);
export const hashDeTeste = (numero: number): string => numero.toString(16).padStart(64, '0');

export const URN_DESEMPENHO = urnDeTeste('tabela_de_dados', 'desempenho-ads');
export const URN_BENCHMARK_B = urnDeTeste('conhecimento', 'benchmark-b');
export const URN_BENCHMARK_D = urnDeTeste('conhecimento', 'benchmark-d');
export const URN_BENCHMARK_VENCIDO = urnDeTeste('conhecimento', 'benchmark-vencido');
export const URN_REGRA_LEGAL = urnDeTeste('conhecimento', 'regra-publicidade');
export const URN_LIMITE = urnDeTeste('limite', 'teto-mensal');
export const URN_RESTRITA = urnDeTeste('tabela_de_dados', 'base-restrita');

export function pacoteDeTeste(): PacoteDeLeitura {
  return {
    organizacaoId: ORGANIZACAO_ID,
    clienteId: CLIENTE_ID,
    lidoEm: '2026-11-25T10:00:00.000Z',
    entradas: [
      { urn: URN_DESEMPENHO, hash: hashDeTeste(1), tipo: 'tabela_de_dados', titulo: 'Desempenho de anúncios', resumo: 'Gasto e resultado por canal.', somenteMetadados: false },
      {
        urn: URN_BENCHMARK_B,
        hash: hashDeTeste(2),
        tipo: 'conhecimento',
        titulo: 'Benchmark de custo por lead',
        resumo: 'Pesquisa com método.',
        somenteMetadados: false,
        evidencia: { nota: 'B', categoria: 'benchmark', validoAte: '2027-06-30', verificadoEm: '2026-10-01' },
      },
      {
        urn: URN_BENCHMARK_D,
        hash: hashDeTeste(3),
        tipo: 'conhecimento',
        titulo: 'Afirmação não verificável',
        resumo: 'Sem fonte.',
        somenteMetadados: false,
        evidencia: { nota: 'D', categoria: 'benchmark' },
      },
      {
        urn: URN_BENCHMARK_VENCIDO,
        hash: hashDeTeste(4),
        tipo: 'conhecimento',
        titulo: 'Benchmark antigo',
        resumo: 'Venceu.',
        somenteMetadados: false,
        evidencia: { nota: 'B', categoria: 'benchmark', validoAte: '2026-01-01' },
      },
      {
        urn: URN_REGRA_LEGAL,
        hash: hashDeTeste(5),
        tipo: 'conhecimento',
        titulo: 'Regra de publicidade',
        resumo: 'Regra legal obrigatória.',
        somenteMetadados: false,
        evidencia: { nota: 'A', categoria: 'regra_legal', obrigatoria: true, jurisdicao: 'BR', validoAte: '2027-12-31', verificadoEm: '2026-11-01' },
      },
      { urn: URN_LIMITE, hash: hashDeTeste(6), tipo: 'limite', titulo: 'Teto mensal', resumo: 'Gasto máximo por mês.', somenteMetadados: false },
      { urn: URN_RESTRITA, hash: hashDeTeste(7), tipo: 'tabela_de_dados', titulo: 'Base restrita', resumo: 'Só metadados.', somenteMetadados: true },
    ],
  };
}

export const evidencia = (urn: string, papel: PapelDaEvidencia = 'favor'): Evidencia => ({ urn, papel });

export const afirmacao = (texto: string, ...evidencias: Evidencia[]): Afirmacao =>
  evidencias.length > 0 ? { texto, evidencias, hipotese: false } : { texto, evidencias: [], hipotese: true };

const BRL = (centavos: string) => ({ centavos, moeda: 'BRL' as const });
const PERIODO = { inicio: '2026-12-01', fim: '2027-02-28' };

export function planoMinimoBruto(): Plano {
  return {
    schema_version: 1,
    resumo_executivo: {
      objetivo: 'Gerar leads qualificados para a Loja Exemplo.',
      aposta_central: afirmacao('Busca paga de fundo de funil concentra a demanda existente.'),
      verba: BRL('1000000'),
      resultado_esperado: afirmacao('Custo por lead dentro do benchmark do setor.', evidencia(URN_BENCHMARK_B)),
    },
    intencao: {
      objetivo: 'Gerar 600 leads qualificados no trimestre.',
      horizonte: PERIODO,
      ousadia: 'moderado',
      retorno_esperado: { descricao: 'Custo por lead abaixo de R$ 50.' },
      verba: BRL('1000000'),
    },
    diagnostico: {
      situacao: afirmacao('A conta tem histórico de gasto em busca e social.', evidencia(URN_DESEMPENHO)),
      historico_de_desempenho: [],
      obstaculo_principal: afirmacao('Custo por lead sobe quando a verba cresce.'),
      o_que_os_dados_mostram: [],
    },
    publico_alvo: {
      segmentos: [{ id: 'seg_local', nome: 'Compradores da região', descricao: afirmacao('Pessoas que já pesquisam o produto.'), momentos_de_compra: [] }],
    },
    comunidades_alvo: { comunidades: [] },
    posicionamento_e_mensagem: {
      promessa: afirmacao('Qualidade com entrega rápida.'),
      provas: [],
      tom: 'Direto e acolhedor.',
      a_marca_nao_diz: [],
    },
    estrategia: { politica: afirmacao('Concentrar verba onde já existe demanda.'), nao_faremos: [], hipoteses: [] },
    canais_e_plataformas: {
      canais: [
        { id: 'cn_busca', canal: 'busca', plataforma: 'google', papel: 'ativacao', justificativa: afirmacao('Captura demanda declarada.', evidencia(URN_DESEMPENHO)) },
      ],
    },
    campanhas: {
      campanhas: [
        {
          id: 'cp_busca',
          nome: 'Busca de fundo de funil',
          objetivo: 'Captar pedidos de orçamento.',
          canal: 'busca',
          plataforma: 'google',
          segmento_id: 'seg_local',
          oferta: 'Orçamento sem compromisso.',
          formato: 'busca_responsiva',
          conceito_id: 'cc_orcamento',
          verba: BRL('1000000'),
          periodo: PERIODO,
          metrica_de_sucesso: 'Custo por lead',
          meta_id: 'm_canal',
        },
      ],
    },
    criativos: {
      conceitos: [{ id: 'cc_orcamento', titulo: 'Orçamento rápido', ideia: 'Resposta em até um dia útil.', o_que_testar: 'Promessa de prazo contra promessa de preço.' }],
    },
    orcamento: { total: BRL('1000000'), verba_de_teste: BRL('100000'), por_canal: [] },
    metas_e_metricas: {
      metas: [
        {
          id: 'm_neg',
          nivel: 'negocio',
          pai_id: null,
          nome: 'Leads qualificados',
          metrica: 'Leads qualificados',
          previsto: { unidade: 'contagem', quantidade: 600 },
          janela: PERIODO,
          metrica_de_custo: 'Custo por lead',
          metrica_de_qualidade: 'Taxa de qualificação',
          nota_da_evidencia: 'B',
          evidencias: [evidencia(URN_BENCHMARK_B)],
          hipotese: false,
        },
        {
          id: 'm_canal',
          nivel: 'canal',
          pai_id: 'm_neg',
          nome: 'Custo por lead na busca',
          metrica: 'Custo por lead',
          previsto: { unidade: 'brl_centavos', centavos: '5000', moeda: 'BRL' },
          janela: PERIODO,
          metrica_de_custo: 'Custo por lead',
          metrica_de_qualidade: 'Taxa de qualificação',
          medida_de_limite: 'custo_por_lead',
          evidencias: [],
          hipotese: true,
        },
      ],
    },
    medicao: {
      itens: [
        { meta_id: 'm_neg', como_medir: 'Leads qualificados no CRM por semana.', fonte: 'CRM' },
        { meta_id: 'm_canal', como_medir: 'Gasto da campanha dividido por leads.', fonte: 'Painel de anúncios' },
      ],
    },
    calendario: { fases: [{ id: 'f1', nome: 'Execução', periodo: PERIODO, marcos: [{ data: '2027-01-15', descricao: 'Revisão de meio de percurso.' }] }] },
    riscos_e_regras: {
      riscos: [{ id: 'r1', descricao: 'Aumento do custo de mídia.', mitigacao: 'Revisão semanal do lance.', severidade: 'media', evidencias: [] }],
      regras_aplicaveis: [{ id: 'rg1', resumo: 'Publicidade segue a regra legal obrigatória.', evidencias: [evidencia(URN_REGRA_LEGAL)] }],
      limites_do_cliente: [{ id: 'lm1', resumo: 'Gasto abaixo do teto mensal.', evidencias: [evidencia(URN_LIMITE)] }],
      limites_nao_aplicaveis: [],
    },
    lacunas: { itens: [] },
  };
}

export function planoMinimo(): Plano {
  return lerValido(planoMinimoBruto());
}

function lerValido(bruto: unknown): Plano {
  const resultado = lerPlano(bruto);
  if (!resultado.ok) throw new Error(`Fixture inválida: ${JSON.stringify(resultado.error.problemas)}`);
  return resultado.value;
}

export function planoCompletoBruto(): Plano {
  const base = structuredClone(planoMinimoBruto());
  base.publico_alvo.segmentos.push({
    id: 'seg_empresas',
    nome: 'Pequenas empresas',
    descricao: afirmacao('Compradores recorrentes de pedidos maiores.', evidencia(URN_DESEMPENHO)),
    tamanho_estimado: afirmacao('Cerca de 10 mil empresas na região.'),
    quem_converte: afirmacao('Responsáveis de compras.', evidencia(URN_DESEMPENHO)),
    momentos_de_compra: ['Início de trimestre', 'Reposição de estoque'],
  });
  base.comunidades_alvo.comunidades.push({
    id: 'cm_associacao',
    nome: 'Associação comercial local',
    onde: 'Grupos de associação comercial.',
    como_entrar: afirmacao('Patrocínio de eventos pequenos.'),
    segmento_id: 'seg_empresas',
    tipo_de_creator: 'Especialista do setor',
  });
  base.diagnostico.historico_de_desempenho.push(afirmacao('Gasto estável nos últimos meses.', evidencia(URN_DESEMPENHO)));
  base.diagnostico.o_que_os_dados_mostram.push(afirmacao('Busca converte mais que social.', evidencia(URN_DESEMPENHO)));
  base.posicionamento_e_mensagem.provas.push(afirmacao('Avaliações positivas de clientes.'));
  base.posicionamento_e_mensagem.a_marca_nao_diz.push('Preço mais baixo da cidade.');
  base.estrategia.nao_faremos.push(
    { id: 'nf_tiktok', texto: 'Não anunciaremos em TikTok.', teste: { tipo: 'plataforma_proibida', valor: 'tiktok' } },
    { id: 'nf_tom', texto: 'Não usaremos humor com o produto.' },
  );
  base.estrategia.hipoteses.push({
    id: 'h_prazo',
    afirmacao: 'Prometer prazo converte mais que prometer preço.',
    premissas: ['Clientes comparam prazo antes de preço.'],
    evidencias: [evidencia(URN_BENCHMARK_B, 'favor'), evidencia(URN_DESEMPENHO, 'premissa')],
    metrica: 'Taxa de conversão',
    limiar: 'Pelo menos 15 por cento acima do controle',
    data_de_checagem: '2027-01-31',
  });
  base.canais_e_plataformas.canais.push({
    id: 'cn_social',
    canal: 'social',
    plataforma: 'meta',
    papel: 'marca',
    justificativa: afirmacao('Constrói lembrança entre empresas.'),
  });
  base.canais_e_plataformas.divisao_marca_e_ativacao = afirmacao('Sessenta por cento em ativação como ponto de partida.');
  base.campanhas.campanhas = [
    { ...base.campanhas.campanhas[0]!, verba: BRL('600000') },
    {
      id: 'cp_social',
      nome: 'Social para empresas',
      objetivo: 'Gerar lembrança entre pequenas empresas.',
      canal: 'social',
      plataforma: 'meta',
      segmento_id: 'seg_empresas',
      oferta: 'Guia de compras para empresas.',
      formato: 'carrossel',
      conceito_id: 'cc_guia',
      verba: BRL('400000'),
      periodo: PERIODO,
      metrica_de_sucesso: 'Custo por lead',
      meta_id: 'm_social',
    },
  ];
  base.criativos.conceitos.push({ id: 'cc_guia', titulo: 'Guia de compras', ideia: 'Conteúdo útil antes da oferta.', o_que_testar: 'Guia contra oferta direta.', hipotese_id: 'h_prazo' });
  base.orcamento.por_canal = [
    { canal_id: 'cn_busca', valor: BRL('600000') },
    { canal_id: 'cn_social', valor: BRL('400000') },
  ];
  base.metas_e_metricas.metas.push({
    id: 'm_social',
    nivel: 'canal',
    pai_id: 'm_neg',
    nome: 'Alcance qualificado em social',
    metrica: 'Alcance de empresas',
    previsto: { unidade: 'contagem', quantidade: 50000 },
    janela: PERIODO,
    metrica_de_custo: 'Custo por mil',
    metrica_de_qualidade: 'Taxa de clique qualificado',
    evidencias: [evidencia(URN_BENCHMARK_B)],
    hipotese: false,
  });
  base.medicao.itens.push({
    meta_id: 'm_social',
    como_medir: 'Alcance reportado pela plataforma.',
    fonte: 'Painel de anúncios',
    experimento: { tipo: 'lift_de_plataforma', descricao: 'Teste de lift de marca.' },
    criterio_de_parada: 'Custo por mil acima do dobro do previsto.',
    criterio_de_escala: 'Lift positivo com significância.',
  });
  base.calendario.fases.push({ id: 'f2', nome: 'Revisão', periodo: { inicio: '2027-02-01', fim: '2027-02-28' }, marcos: [] });
  base.riscos_e_regras.riscos.push({ id: 'r2', descricao: 'Queda de qualidade do lead.', mitigacao: 'Revisão com vendas.', severidade: 'alta', evidencias: [evidencia(URN_DESEMPENHO, 'contra')] });
  base.lacunas.itens.push({ id: 'l1', tipo: 'dado_ausente', descricao: 'Sem dado de margem por produto.', impacto: 'Meta de retorno fica como hipótese.', como_preencher: 'Registrar margem no contexto do cliente.' });
  return base;
}

export function planoCompleto(): Plano {
  return lerValido(planoCompletoBruto());
}

export function contextoDeTeste(sobrescrita: Partial<ContextoDoGate> = {}): ContextoDoGate {
  return {
    plano: planoCompleto(),
    pacote: pacoteDeTeste(),
    hoje: HOJE,
    pareceres: PERSONAS.map((persona) => parecer(persona.chave, 'aprova')),
    avaliarLimite: () => 'ok',
    medidasComLimite: [],
    ...sobrescrita,
  };
}
