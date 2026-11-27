import { z } from 'zod';
import { err, ok, type Result } from '../../../shared/result/result.ts';
import { CATEGORIAS } from '../../clients/domain/regras/categoria.ts';
import { EscopoSchema, ChaveSchema } from '../../clients/domain/regras/definicaoDeLimite.ts';
import { MEDIDAS } from '../../clients/domain/regras/medida.ts';
import { ValorSchema } from '../../clients/domain/regras/valor.ts';
import { lerUrn } from '../../brain/domain/urn.ts';
import { esquemaData } from './datas.ts';
import { esquemaDinheiro } from './dinheiro.ts';

export const SCHEMA_VERSION = 1;
export const TAMANHO_MAXIMO_DO_PLANO_BYTES = 262144;

export const CANAIS = [
  'busca',
  'social',
  'video',
  'display',
  'email',
  'mensageria',
  'conteudo_organico',
  'creators',
  'marketplace',
  'offline',
] as const;
export type Canal = (typeof CANAIS)[number];

export const PLATAFORMAS = [
  'google',
  'meta',
  'youtube',
  'tiktok',
  'linkedin',
  'microsoft',
  'x',
  'pinterest',
  'kwai',
  'whatsapp',
  'email',
  'rd_station',
  'outra',
] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];

export const FORMATOS = [
  'imagem',
  'video_curto',
  'video_longo',
  'carrossel',
  'texto',
  'audio',
  'formulario_nativo',
  'busca_responsiva',
  'catalogo',
  'stories',
  'email',
  'mensagem',
] as const;
export type Formato = (typeof FORMATOS)[number];

export const MEDIDAS_QUE_PODEM_NAO_SE_APLICAR = MEDIDAS.filter((medida) => medida !== 'gasto') as unknown as readonly [
  Exclude<(typeof MEDIDAS)[number], 'gasto'>,
  ...Exclude<(typeof MEDIDAS)[number], 'gasto'>[],
];

export const OUSADIAS = ['conservador', 'moderado', 'ousado'] as const;
export const PAPEIS_DA_EVIDENCIA = ['favor', 'contra', 'premissa'] as const;
export type PapelDaEvidencia = (typeof PAPEIS_DA_EVIDENCIA)[number];
export const PAPEIS_DO_CANAL = ['marca', 'ativacao', 'retencao', 'teste'] as const;
export const SEVERIDADES = ['baixa', 'media', 'alta'] as const;
export const TIPOS_DE_EXPERIMENTO = ['holdout', 'geo', 'lift_de_plataforma', 'antes_e_depois'] as const;
export const NIVEIS_DE_META = ['negocio', 'canal'] as const;

export const SECOES_DO_PLANO = [
  'resumo_executivo',
  'intencao',
  'diagnostico',
  'publico_alvo',
  'comunidades_alvo',
  'posicionamento_e_mensagem',
  'estrategia',
  'canais_e_plataformas',
  'campanhas',
  'orcamento',
  'metas_e_metricas',
  'medicao',
  'calendario',
  'plano_de_midia',
  'riscos_e_regras',
  'lacunas',
] as const;
export type SecaoDoPlano = (typeof SECOES_DO_PLANO)[number];

const texto = (maximo: number) => z.string().min(1).max(maximo).regex(/\S/, 'Texto não pode ser vazio.');
const lista = <T extends z.ZodType>(item: T, maximo: number) => z.array(item).max(maximo);

export const esquemaId = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'Id curto em minúsculas, dígitos e _ (até 32).');

export const esquemaUrn = z
  .string()
  .max(320)
  .refine((valor) => lerUrn(valor) !== null, 'URN inválida.');

export const esquemaEvidencia = z.strictObject({
  urn: esquemaUrn,
  papel: z.enum(PAPEIS_DA_EVIDENCIA),
});
export type Evidencia = z.infer<typeof esquemaEvidencia>;

const evidencias = lista(esquemaEvidencia, 20);

type ComFundamento = { readonly evidencias: readonly unknown[]; readonly hipotese: boolean };
const temFundamento = (valor: ComFundamento) => valor.hipotese || valor.evidencias.length > 0;
const MENSAGEM_DE_FUNDAMENTO = 'Toda afirmação cita evidência ou é marcada como hipótese.';

export const esquemaAfirmacao = z
  .strictObject({ texto: texto(600), evidencias, hipotese: z.boolean() })
  .refine(temFundamento, MENSAGEM_DE_FUNDAMENTO);
export type Afirmacao = z.infer<typeof esquemaAfirmacao>;

const esquemaPeriodo = z
  .strictObject({ inicio: esquemaData, fim: esquemaData })
  .refine((periodo) => periodo.inicio <= periodo.fim, 'Início não pode ser depois do fim.');
export type Periodo = z.infer<typeof esquemaPeriodo>;

const esquemaQuantia = z.discriminatedUnion('unidade', [
  ...ValorSchema.options,
  z.strictObject({ unidade: z.literal('contagem'), quantidade: z.number().int().min(0).max(1_000_000_000_000) }),
]);
export type Quantia = z.infer<typeof esquemaQuantia>;

const esquemaPlataformasEscolhidas = z
  .array(z.enum(PLATAFORMAS))
  .min(1)
  .max(PLATAFORMAS.length)
  .refine((itens) => new Set(itens).size === itens.length, 'Plataforma repetida.');

const esquemaWhatsapp = z.string().regex(/^\+[1-9]\d{7,14}$/, 'WhatsApp no formato E.164, por exemplo +5511999998888.');

const esquemaDestino = z.strictObject({
  landingPageId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Id de landing page inválido.'),
  url: z
    .string()
    .max(2048)
    .refine((valor) => {
      try {
        return new URL(valor).protocol === 'https:';
      } catch {
        return false;
      }
    }, 'URL https válida.'),
});
export type Destino = z.infer<typeof esquemaDestino>;

const esquemaUtm = z.strictObject({
  utm_source: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  utm_medium: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  utm_campaign: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
});
const esquemaUtmPorPlataforma = z.partialRecord(z.enum(PLATAFORMAS), esquemaUtm);

const formaBaseDaIntencao = {
  objetivo: texto(600),
  horizonte: esquemaPeriodo,
  ousadia: z.enum(OUSADIAS),
  retorno_esperado: z.strictObject({ descricao: texto(400), valor: esquemaQuantia.optional() }),
  verba: esquemaDinheiro,
};

export const esquemaIntencaoBase = z.strictObject(formaBaseDaIntencao);
export type IntencaoBase = z.infer<typeof esquemaIntencaoBase>;
export const esquemaPlataformasDoPedido = esquemaPlataformasEscolhidas;

type ComEntradasDeCanal = {
  readonly plataformas?: readonly Plataforma[] | undefined;
  readonly utm?: Partial<Record<Plataforma, unknown>> | undefined;
};

function utmSoDasPlataformasEscolhidas(intencao: ComEntradasDeCanal): boolean {
  if (intencao.utm === undefined) return true;
  const escolhidas = new Set<string>(intencao.plataformas ?? []);
  return Object.keys(intencao.utm).every((plataforma) => escolhidas.has(plataforma));
}
const MENSAGEM_DE_UTM = 'UTM só para plataforma escolhida.';

export const esquemaIntencao = z
  .strictObject({
    ...formaBaseDaIntencao,
    plataformas: esquemaPlataformasEscolhidas,
    whatsapp: esquemaWhatsapp.optional(),
    destino: esquemaDestino,
    utm: esquemaUtmPorPlataforma,
  })
  .refine(utmSoDasPlataformasEscolhidas, MENSAGEM_DE_UTM);
export type Intencao = z.infer<typeof esquemaIntencao>;

export const esquemaIntencaoDoPlano = z
  .strictObject({
    ...formaBaseDaIntencao,
    plataformas: esquemaPlataformasEscolhidas.optional(),
    whatsapp: esquemaWhatsapp.optional(),
    destino: esquemaDestino.optional(),
    utm: esquemaUtmPorPlataforma.optional(),
  })
  .refine(utmSoDasPlataformasEscolhidas, MENSAGEM_DE_UTM);
export type IntencaoDoPlano = z.infer<typeof esquemaIntencaoDoPlano>;

const esquemaResumoExecutivo = z.strictObject({
  objetivo: texto(400),
  aposta_central: esquemaAfirmacao,
  verba: esquemaDinheiro,
  resultado_esperado: esquemaAfirmacao,
});

const esquemaDiagnostico = z.strictObject({
  situacao: esquemaAfirmacao,
  historico_de_desempenho: lista(esquemaAfirmacao, 20),
  obstaculo_principal: esquemaAfirmacao,
  o_que_os_dados_mostram: lista(esquemaAfirmacao, 30),
});

const esquemaSegmento = z.strictObject({
  id: esquemaId,
  nome: texto(120),
  descricao: esquemaAfirmacao,
  tamanho_estimado: esquemaAfirmacao.optional(),
  quem_converte: esquemaAfirmacao.optional(),
  momentos_de_compra: lista(texto(200), 10),
});
export type Segmento = z.infer<typeof esquemaSegmento>;

const esquemaComunidade = z.strictObject({
  id: esquemaId,
  nome: texto(120),
  onde: texto(300),
  como_entrar: esquemaAfirmacao,
  segmento_id: esquemaId.optional(),
  tipo_de_creator: texto(200).optional(),
});

const esquemaPosicionamento = z.strictObject({
  promessa: esquemaAfirmacao,
  provas: lista(esquemaAfirmacao, 10),
  tom: texto(300),
  a_marca_nao_diz: lista(texto(200), 15),
});

export const TIPOS_DE_TESTE_DO_NAO_FAREMOS = ['canal_proibido', 'plataforma_proibida', 'formato_proibido', 'publico_proibido'] as const;

const esquemaTesteEstruturado = z.discriminatedUnion('tipo', [
  z.strictObject({ tipo: z.literal('canal_proibido'), valor: z.enum(CANAIS) }),
  z.strictObject({ tipo: z.literal('plataforma_proibida'), valor: z.enum(PLATAFORMAS) }),
  z.strictObject({ tipo: z.literal('formato_proibido'), valor: z.enum(FORMATOS) }),
  z.strictObject({ tipo: z.literal('publico_proibido'), valor: esquemaId }),
]);
export type TesteEstruturado = z.infer<typeof esquemaTesteEstruturado>;

const esquemaNaoFaremos = z.strictObject({
  id: esquemaId,
  texto: texto(400),
  teste: esquemaTesteEstruturado.optional(),
});
export type NaoFaremos = z.infer<typeof esquemaNaoFaremos>;

const esquemaHipotese = z.strictObject({
  id: esquemaId,
  afirmacao: texto(500),
  premissas: lista(texto(400), 10),
  evidencias,
  metrica: texto(120),
  limiar: texto(200),
  data_de_checagem: esquemaData,
});
export type Hipotese = z.infer<typeof esquemaHipotese>;

const esquemaEstrategia = z.strictObject({
  politica: esquemaAfirmacao,
  nao_faremos: lista(esquemaNaoFaremos, 30),
  hipoteses: lista(esquemaHipotese, 30),
});

const esquemaCanalDoPlano = z.strictObject({
  id: esquemaId,
  canal: z.enum(CANAIS),
  plataforma: z.enum(PLATAFORMAS).optional(),
  papel: z.enum(PAPEIS_DO_CANAL),
  justificativa: esquemaAfirmacao,
});
export type CanalDoPlano = z.infer<typeof esquemaCanalDoPlano>;

const esquemaCanaisEPlataformas = z.strictObject({
  canais: lista(esquemaCanalDoPlano, 12),
  divisao_marca_e_ativacao: esquemaAfirmacao.optional(),
});

const esquemaCampanha = z.strictObject({
  id: esquemaId,
  nome: texto(120),
  objetivo: texto(300),
  canal: z.enum(CANAIS),
  plataforma: z.enum(PLATAFORMAS).optional(),
  segmento_id: esquemaId,
  oferta: texto(300),
  formato: z.enum(FORMATOS),
  verba: esquemaDinheiro,
  periodo: esquemaPeriodo,
  metrica_de_sucesso: texto(200),
  meta_id: esquemaId,
});
export type Campanha = z.infer<typeof esquemaCampanha>;

const esquemaOrcamento = z.strictObject({
  total: esquemaDinheiro,
  verba_de_teste: esquemaDinheiro,
  por_canal: lista(z.strictObject({ canal_id: esquemaId, valor: esquemaDinheiro }), 12),
});

const esquemaMeta = z
  .strictObject({
    id: esquemaId,
    nivel: z.enum(NIVEIS_DE_META),
    pai_id: esquemaId.nullable(),
    nome: texto(160),
    metrica: texto(120),
    previsto: esquemaQuantia,
    janela: esquemaPeriodo,
    metrica_de_custo: texto(120),
    metrica_de_qualidade: texto(120),
    nota_da_evidencia: z.enum(['A', 'B', 'C', 'D']).optional(),
    medida_de_limite: z.enum(MEDIDAS).optional(),
    evidencias,
    hipotese: z.boolean(),
  })
  .refine(temFundamento, MENSAGEM_DE_FUNDAMENTO);
export type Meta = z.infer<typeof esquemaMeta>;

const esquemaItemDeMedicao = z.strictObject({
  meta_id: esquemaId,
  como_medir: texto(400),
  fonte: texto(200),
  experimento: z.strictObject({ tipo: z.enum(TIPOS_DE_EXPERIMENTO), descricao: texto(300) }).optional(),
  criterio_de_parada: texto(300).optional(),
  criterio_de_escala: texto(300).optional(),
});
export type ItemDeMedicao = z.infer<typeof esquemaItemDeMedicao>;

const esquemaFase = z.strictObject({
  id: esquemaId,
  nome: texto(120),
  periodo: esquemaPeriodo,
  marcos: lista(z.strictObject({ data: esquemaData, descricao: texto(200) }), 10),
});

const esquemaRisco = z.strictObject({
  id: esquemaId,
  descricao: texto(400),
  mitigacao: texto(400),
  severidade: z.enum(SEVERIDADES),
  evidencias,
});

const esquemaRegraAplicavel = z.strictObject({
  id: esquemaId,
  resumo: texto(400),
  evidencias: z.array(esquemaEvidencia).min(1).max(20),
});

export const TIPOS_DE_LACUNA = ['limite_ausente', 'dado_ausente', 'evidencia_fraca', 'regra_ausente', 'outro'] as const;
export type TipoDeLacuna = (typeof TIPOS_DE_LACUNA)[number];

export const NATUREZAS_DA_REGRA_DA_LACUNA = ['limite', 'regra'] as const;
export const ORIGENS_DA_SUGESTAO = ['evidencia', 'hipotese'] as const;

const esquemaRegraDaLacuna = z.strictObject({
  natureza: z.enum(NATUREZAS_DA_REGRA_DA_LACUNA),
  categoria: z.enum(CATEGORIAS).optional(),
  chave: ChaveSchema.optional(),
  escopo: EscopoSchema,
});
export type RegraDaLacuna = z.infer<typeof esquemaRegraDaLacuna>;

const esquemaValorDaSugestao = z.union([ValorSchema, z.strictObject({ texto: texto(400) })]);
export type ValorDaSugestao = z.infer<typeof esquemaValorDaSugestao>;

const esquemaSugestaoDaLacuna = z
  .strictObject({
    valor: esquemaValorDaSugestao.nullable(),
    origem: z.enum(ORIGENS_DA_SUGESTAO),
    evidencias: lista(esquemaEvidencia, 5).default([]),
    justificativa: texto(300),
  })
  .superRefine((sugestao, contexto) => {
    const sustentos = sugestao.evidencias.filter((e) => e.papel !== 'contra');
    if (sugestao.origem === 'hipotese' && (sugestao.valor !== null || sugestao.evidencias.length > 0)) {
      contexto.addIssue({ code: 'custom', path: ['valor'], message: 'Hipótese não traz valor nem evidência: sem evidência só há "sem sugestão".' });
    }
    if (sugestao.origem === 'evidencia' && sustentos.length === 0) {
      contexto.addIssue({ code: 'custom', path: ['evidencias'], message: 'Sugestão com origem em evidência cita ao menos uma evidência a favor.' });
    }
    if (sugestao.valor !== null && sugestao.origem !== 'evidencia') {
      contexto.addIssue({ code: 'custom', path: ['origem'], message: 'Valor sugerido exige origem em evidência do Brain.' });
    }
  });
export type SugestaoDaLacuna = z.infer<typeof esquemaSugestaoDaLacuna>;

const esquemaLacuna = z
  .strictObject({
    id: esquemaId,
    tipo: z.enum(TIPOS_DE_LACUNA),
    medida: z.enum(MEDIDAS).optional(),
    descricao: texto(400),
    impacto: texto(300),
    como_preencher: texto(300).optional(),
    regra: esquemaRegraDaLacuna.optional(),
    sugestao: esquemaSugestaoDaLacuna.optional(),
  })
  .superRefine((lacuna, contexto) => {
    if (lacuna.tipo === 'limite_ausente' && lacuna.medida === undefined) {
      contexto.addIssue({ code: 'custom', path: ['medida'], message: 'Lacuna de limite ausente informa a medida.' });
    }
    if (lacuna.tipo !== 'limite_ausente' && lacuna.medida !== undefined) {
      contexto.addIssue({ code: 'custom', path: ['medida'], message: 'Só a lacuna de limite ausente tem medida.' });
    }
    const { regra, sugestao } = lacuna;
    if (regra === undefined) {
      if (sugestao !== undefined) contexto.addIssue({ code: 'custom', path: ['sugestao'], message: 'Sugestão exige a regra estruturada da lacuna.' });
      return;
    }
    if (regra.natureza === 'limite' && lacuna.tipo !== 'limite_ausente') {
      contexto.addIssue({ code: 'custom', path: ['regra', 'natureza'], message: 'Regra de natureza limite só em lacuna de limite ausente.' });
    }
    if (regra.natureza === 'regra' && (lacuna.tipo === 'limite_ausente' || regra.categoria === undefined || regra.chave === undefined)) {
      contexto.addIssue({ code: 'custom', path: ['regra', 'chave'], message: 'Regra que não é limite informa categoria e chave e não vem de lacuna de limite.' });
    }
    const valor = sugestao?.valor;
    if (valor !== undefined && valor !== null) {
      const ehTexto = 'texto' in valor;
      if (regra.natureza === 'limite' && ehTexto) contexto.addIssue({ code: 'custom', path: ['sugestao', 'valor'], message: 'Limite sugere valor numérico, não texto.' });
      if (regra.natureza === 'regra' && !ehTexto) contexto.addIssue({ code: 'custom', path: ['sugestao', 'valor'], message: 'Regra sugere texto, não número.' });
    }
  });
export type Lacuna = z.infer<typeof esquemaLacuna>;

const esquemaLimiteNaoAplicavel = z.strictObject({
  medida: z.enum(MEDIDAS_QUE_PODEM_NAO_SE_APLICAR),
  motivo: texto(300),
});
export type LimiteNaoAplicavel = z.infer<typeof esquemaLimiteNaoAplicavel>;

export const SECOES_PADRAO_DO_PLANO_DE_MIDIA = [
  'objetivo',
  'publico',
  'orcamento_e_lances',
  'programacao',
  'posicionamentos',
  'conversao',
  'copy',
  'testes_ab',
  'metas',
] as const;

export const MAXIMO_DE_CAMPOS_DO_PLANO_DE_MIDIA = 400;

export const esquemaChaveDeCampo = z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/, 'Chave de campo em minúsculas, dígitos, _ e . (até 64).');

const esquemaValorDoCampo = z.union([texto(600), z.number(), z.boolean(), lista(texto(200), 50)]);
export type ValorDoCampo = z.infer<typeof esquemaValorDoCampo>;

const esquemaCampoDeMidia = z.strictObject({
  campo: esquemaChaveDeCampo,
  valor: esquemaValorDoCampo,
  justificativa: z.string().max(300),
  evidencias: lista(esquemaEvidencia, 3).default([]),
});
export type CampoDeMidia = z.infer<typeof esquemaCampoDeMidia>;

const esquemaSecaoDeMidia = z.strictObject({
  secao: esquemaId,
  campos: lista(esquemaCampoDeMidia, 80),
});

export const esquemaMidiaDaPlataforma = z.strictObject({
  plataforma: z.enum(PLATAFORMAS),
  secoes: lista(esquemaSecaoDeMidia, 20),
});
export type MidiaDaPlataforma = z.infer<typeof esquemaMidiaDaPlataforma>;

export const esquemaPlanoDeMidia = z.strictObject({ plataformas: lista(esquemaMidiaDaPlataforma, PLATAFORMAS.length) });

export const ESQUEMAS_DAS_SECOES = {
  resumo_executivo: esquemaResumoExecutivo,
  intencao: esquemaIntencaoDoPlano,
  diagnostico: esquemaDiagnostico,
  publico_alvo: z.strictObject({ segmentos: lista(esquemaSegmento, 12) }),
  comunidades_alvo: z.strictObject({ comunidades: lista(esquemaComunidade, 20) }),
  posicionamento_e_mensagem: esquemaPosicionamento,
  estrategia: esquemaEstrategia,
  canais_e_plataformas: esquemaCanaisEPlataformas,
  campanhas: z.strictObject({ campanhas: lista(esquemaCampanha, 30) }),
  orcamento: esquemaOrcamento,
  metas_e_metricas: z.strictObject({ metas: lista(esquemaMeta, 40) }),
  medicao: z.strictObject({ itens: lista(esquemaItemDeMedicao, 40) }),
  calendario: z.strictObject({ fases: lista(esquemaFase, 20) }),
  plano_de_midia: esquemaPlanoDeMidia,
  riscos_e_regras: z.strictObject({
    riscos: lista(esquemaRisco, 30),
    regras_aplicaveis: lista(esquemaRegraAplicavel, 30),
    limites_do_cliente: lista(esquemaRegraAplicavel, 30),
    limites_nao_aplicaveis: lista(esquemaLimiteNaoAplicavel, 20).default([]),
  }),
  lacunas: z.strictObject({ itens: lista(esquemaLacuna, 30) }),
} as const satisfies Record<SecaoDoPlano, z.ZodType>;

const secoesDoPlano = ESQUEMAS_DAS_SECOES;

type Problema = { readonly caminho: (string | number)[]; readonly mensagem: string };

function idsRepetidos(ids: readonly string[]): string[] {
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const id of ids) {
    if (vistos.has(id)) repetidos.add(id);
    vistos.add(id);
  }
  return [...repetidos].sort();
}

type EstruturaDoPlano = { readonly [S in SecaoDoPlano]: z.infer<(typeof secoesDoPlano)[S]> };

export type SecoesParciaisDoPlano = Partial<EstruturaDoPlano>;

function problemasDeIntegridade(plano: SecoesParciaisDoPlano): Problema[] {
  const problemas: Problema[] = [];
  const registrar = (caminho: (string | number)[], mensagem: string) => problemas.push({ caminho, mensagem });

  const colecoes: readonly (readonly [string[], readonly { readonly id: string }[] | undefined])[] = [
    [['publico_alvo', 'segmentos'], plano.publico_alvo?.segmentos],
    [['comunidades_alvo', 'comunidades'], plano.comunidades_alvo?.comunidades],
    [['estrategia', 'nao_faremos'], plano.estrategia?.nao_faremos],
    [['estrategia', 'hipoteses'], plano.estrategia?.hipoteses],
    [['canais_e_plataformas', 'canais'], plano.canais_e_plataformas?.canais],
    [['campanhas', 'campanhas'], plano.campanhas?.campanhas],
    [['metas_e_metricas', 'metas'], plano.metas_e_metricas?.metas],
    [['calendario', 'fases'], plano.calendario?.fases],
    [['riscos_e_regras', 'riscos'], plano.riscos_e_regras?.riscos],
    [['riscos_e_regras', 'regras_aplicaveis'], plano.riscos_e_regras?.regras_aplicaveis],
    [['riscos_e_regras', 'limites_do_cliente'], plano.riscos_e_regras?.limites_do_cliente],
    [['lacunas', 'itens'], plano.lacunas?.itens],
  ];
  for (const [caminho, itens] of colecoes) {
    if (itens === undefined) continue;
    for (const repetido of idsRepetidos(itens.map((item) => item.id))) registrar(caminho, `Id repetido: ${repetido}.`);
  }

  const segmentos = plano.publico_alvo ? new Set(plano.publico_alvo.segmentos.map((s) => s.id)) : null;
  const canais = plano.canais_e_plataformas ? new Set(plano.canais_e_plataformas.canais.map((c) => c.id)) : null;
  const metas = plano.metas_e_metricas ? new Map(plano.metas_e_metricas.metas.map((m) => [m.id, m])) : null;

  plano.comunidades_alvo?.comunidades.forEach((c, i) => {
    if (segmentos && c.segmento_id !== undefined && !segmentos.has(c.segmento_id)) {
      registrar(['comunidades_alvo', 'comunidades', i, 'segmento_id'], `Segmento inexistente: ${c.segmento_id}.`);
    }
  });
  plano.estrategia?.nao_faremos.forEach((n, i) => {
    if (segmentos && n.teste?.tipo === 'publico_proibido' && !segmentos.has(n.teste.valor)) {
      registrar(['estrategia', 'nao_faremos', i, 'teste', 'valor'], `Segmento inexistente: ${n.teste.valor}.`);
    }
  });
  plano.campanhas?.campanhas.forEach((c, i) => {
    if (segmentos && !segmentos.has(c.segmento_id)) registrar(['campanhas', 'campanhas', i, 'segmento_id'], `Segmento inexistente: ${c.segmento_id}.`);
    if (metas && !metas.has(c.meta_id)) registrar(['campanhas', 'campanhas', i, 'meta_id'], `Meta inexistente: ${c.meta_id}.`);
  });
  plano.orcamento?.por_canal.forEach((p, i) => {
    if (canais && !canais.has(p.canal_id)) registrar(['orcamento', 'por_canal', i, 'canal_id'], `Canal inexistente: ${p.canal_id}.`);
  });
  const escolhidas = plano.intencao?.plataformas === undefined ? null : new Set<string>(plano.intencao.plataformas);
  if (escolhidas) {
    plano.canais_e_plataformas?.canais.forEach((c, i) => {
      if (c.plataforma !== undefined && !escolhidas.has(c.plataforma)) {
        registrar(['canais_e_plataformas', 'canais', i, 'plataforma'], `Plataforma não escolhida: ${c.plataforma}.`);
      }
    });
    plano.campanhas?.campanhas.forEach((c, i) => {
      if (c.plataforma !== undefined && !escolhidas.has(c.plataforma)) {
        registrar(['campanhas', 'campanhas', i, 'plataforma'], `Plataforma não escolhida: ${c.plataforma}.`);
      }
    });
  }
  const midia = plano.plano_de_midia?.plataformas ?? [];
  midia.forEach((entrada, i) => {
    if (escolhidas && !escolhidas.has(entrada.plataforma)) {
      registrar(['plano_de_midia', 'plataformas', i, 'plataforma'], `Plataforma não escolhida: ${entrada.plataforma}.`);
    }
    const chaves = entrada.secoes.flatMap((secao) => secao.campos.map((campo) => campo.campo));
    for (const repetido of idsRepetidos(chaves)) registrar(['plano_de_midia', 'plataformas', i, 'secoes'], `Campo repetido: ${repetido}.`);
  });
  for (const repetida of idsRepetidos(midia.map((entrada) => entrada.plataforma))) {
    registrar(['plano_de_midia', 'plataformas'], `Plataforma repetida: ${repetida}.`);
  }
  const totalDeCampos = midia.reduce((total, entrada) => total + entrada.secoes.reduce((soma, secao) => soma + secao.campos.length, 0), 0);
  if (totalDeCampos > MAXIMO_DE_CAMPOS_DO_PLANO_DE_MIDIA) {
    registrar(['plano_de_midia'], `Plano de mídia com ${totalDeCampos} campos; o máximo é ${MAXIMO_DE_CAMPOS_DO_PLANO_DE_MIDIA}.`);
  }
  plano.metas_e_metricas?.metas.forEach((m, i) => {
    if (m.nivel === 'negocio' && m.pai_id !== null) {
      registrar(['metas_e_metricas', 'metas', i, 'pai_id'], 'Meta de negócio não tem pai.');
    }
    if (m.nivel === 'canal' && (m.pai_id === null || metas?.get(m.pai_id)?.nivel !== 'negocio')) {
      registrar(['metas_e_metricas', 'metas', i, 'pai_id'], 'Meta de canal aponta para uma meta de negócio.');
    }
  });
  plano.medicao?.itens.forEach((item, i) => {
    if (metas && !metas.has(item.meta_id)) registrar(['medicao', 'itens', i, 'meta_id'], `Meta inexistente: ${item.meta_id}.`);
  });
  return problemas;
}

export function problemasDeIntegridadeParcial(secoes: SecoesParciaisDoPlano): readonly { readonly caminho: string; readonly mensagem: string }[] {
  return problemasDeIntegridade(secoes).map((problema) => ({ caminho: problema.caminho.join('.'), mensagem: problema.mensagem }));
}

function ehRegistro(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function semChave(registro: Record<string, unknown>, chave: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(registro).filter(([nome]) => nome !== chave));
}

export function normalizarPlanoLegado(json: unknown): unknown {
  if (!ehRegistro(json)) return json;
  const plano: Record<string, unknown> = semChave(json, 'criativos');
  const campanhas = plano.campanhas;
  if (ehRegistro(campanhas) && Array.isArray(campanhas.campanhas)) {
    plano.campanhas = {
      ...campanhas,
      campanhas: campanhas.campanhas.map((campanha: unknown) => (ehRegistro(campanha) ? semChave(campanha, 'conceito_id') : campanha)),
    };
  }
  if (plano.plano_de_midia === undefined) plano.plano_de_midia = { plataformas: [] };
  return plano;
}

export const esquemaPlano = z.preprocess(
  normalizarPlanoLegado,
  z.strictObject({ schema_version: z.literal(SCHEMA_VERSION), ...secoesDoPlano }).superRefine((plano, contexto) => {
    for (const problema of problemasDeIntegridade(plano)) {
      contexto.addIssue({ code: 'custom', path: problema.caminho, message: problema.mensagem });
    }
  }),
);
export type Plano = z.output<typeof esquemaPlano>;

export function tamanhoDoPlano(plano: unknown): number {
  return new TextEncoder().encode(JSON.stringify(plano)).length;
}

export type ErroDoPlano = {
  readonly codigo: 'plano_invalido' | 'plano_grande_demais';
  readonly mensagem: string;
  readonly problemas: readonly { readonly caminho: string; readonly mensagem: string }[];
};

const MAXIMO_DE_PROBLEMAS = 50;

function tamanhoSeguro(json: unknown): number | null {
  try {
    return tamanhoDoPlano(json);
  } catch {
    return null;
  }
}

export function lerPlano(json: unknown): Result<Plano, ErroDoPlano> {
  const tamanho = tamanhoSeguro(json);
  if (tamanho === null) {
    return err({ codigo: 'plano_invalido', mensagem: 'Plano não é JSON serializável.', problemas: [] });
  }
  if (tamanho > TAMANHO_MAXIMO_DO_PLANO_BYTES) {
    return err({
      codigo: 'plano_grande_demais',
      mensagem: `Plano tem ${tamanho} bytes; o limite é ${TAMANHO_MAXIMO_DO_PLANO_BYTES}.`,
      problemas: [],
    });
  }
  const resultado = esquemaPlano.safeParse(json);
  if (!resultado.success) {
    const problemas = resultado.error.issues.slice(0, MAXIMO_DE_PROBLEMAS).map((problema) => ({
      caminho: problema.path.join('.'),
      mensagem: problema.message,
    }));
    return err({ codigo: 'plano_invalido', mensagem: 'Plano fora do esquema.', problemas });
  }
  return ok(resultado.data);
}
