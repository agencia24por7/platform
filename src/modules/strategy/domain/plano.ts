import { z } from 'zod';
import { err, ok, type Result } from '../../../shared/result/result.ts';
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
  'criativos',
  'orcamento',
  'metas_e_metricas',
  'medicao',
  'calendario',
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

export const esquemaIntencao = z.strictObject({
  objetivo: texto(600),
  horizonte: esquemaPeriodo,
  ousadia: z.enum(OUSADIAS),
  retorno_esperado: z.strictObject({ descricao: texto(400), valor: esquemaQuantia.optional() }),
  verba: esquemaDinheiro,
});
export type Intencao = z.infer<typeof esquemaIntencao>;

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
  conceito_id: esquemaId,
  verba: esquemaDinheiro,
  periodo: esquemaPeriodo,
  metrica_de_sucesso: texto(200),
  meta_id: esquemaId,
});
export type Campanha = z.infer<typeof esquemaCampanha>;

const esquemaConceito = z.strictObject({
  id: esquemaId,
  titulo: texto(120),
  ideia: texto(500),
  o_que_testar: texto(300),
  hipotese_id: esquemaId.optional(),
});

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

const esquemaLacuna = z
  .strictObject({
    id: esquemaId,
    tipo: z.enum(TIPOS_DE_LACUNA),
    medida: z.enum(MEDIDAS).optional(),
    descricao: texto(400),
    impacto: texto(300),
    como_preencher: texto(300).optional(),
  })
  .superRefine((lacuna, contexto) => {
    if (lacuna.tipo === 'limite_ausente' && lacuna.medida === undefined) {
      contexto.addIssue({ code: 'custom', path: ['medida'], message: 'Lacuna de limite ausente informa a medida.' });
    }
    if (lacuna.tipo !== 'limite_ausente' && lacuna.medida !== undefined) {
      contexto.addIssue({ code: 'custom', path: ['medida'], message: 'Só a lacuna de limite ausente tem medida.' });
    }
  });
export type Lacuna = z.infer<typeof esquemaLacuna>;

const esquemaLimiteNaoAplicavel = z.strictObject({
  medida: z.enum(MEDIDAS_QUE_PODEM_NAO_SE_APLICAR),
  motivo: texto(300),
});
export type LimiteNaoAplicavel = z.infer<typeof esquemaLimiteNaoAplicavel>;

const secoesDoPlano = {
  resumo_executivo: esquemaResumoExecutivo,
  intencao: esquemaIntencao,
  diagnostico: esquemaDiagnostico,
  publico_alvo: z.strictObject({ segmentos: lista(esquemaSegmento, 12) }),
  comunidades_alvo: z.strictObject({ comunidades: lista(esquemaComunidade, 20) }),
  posicionamento_e_mensagem: esquemaPosicionamento,
  estrategia: esquemaEstrategia,
  canais_e_plataformas: esquemaCanaisEPlataformas,
  campanhas: z.strictObject({ campanhas: lista(esquemaCampanha, 30) }),
  criativos: z.strictObject({ conceitos: lista(esquemaConceito, 30) }),
  orcamento: esquemaOrcamento,
  metas_e_metricas: z.strictObject({ metas: lista(esquemaMeta, 40) }),
  medicao: z.strictObject({ itens: lista(esquemaItemDeMedicao, 40) }),
  calendario: z.strictObject({ fases: lista(esquemaFase, 20) }),
  riscos_e_regras: z.strictObject({
    riscos: lista(esquemaRisco, 30),
    regras_aplicaveis: lista(esquemaRegraAplicavel, 30),
    limites_do_cliente: lista(esquemaRegraAplicavel, 30),
    limites_nao_aplicaveis: lista(esquemaLimiteNaoAplicavel, 20).default([]),
  }),
  lacunas: z.strictObject({ itens: lista(esquemaLacuna, 30) }),
} as const satisfies Record<SecaoDoPlano, z.ZodType>;

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

function problemasDeIntegridade(plano: EstruturaDoPlano): Problema[] {
  const problemas: Problema[] = [];
  const registrar = (caminho: (string | number)[], mensagem: string) => problemas.push({ caminho, mensagem });

  const colecoes: readonly (readonly [string[], readonly { readonly id: string }[]])[] = [
    [['publico_alvo', 'segmentos'], plano.publico_alvo.segmentos],
    [['comunidades_alvo', 'comunidades'], plano.comunidades_alvo.comunidades],
    [['estrategia', 'nao_faremos'], plano.estrategia.nao_faremos],
    [['estrategia', 'hipoteses'], plano.estrategia.hipoteses],
    [['canais_e_plataformas', 'canais'], plano.canais_e_plataformas.canais],
    [['campanhas', 'campanhas'], plano.campanhas.campanhas],
    [['criativos', 'conceitos'], plano.criativos.conceitos],
    [['metas_e_metricas', 'metas'], plano.metas_e_metricas.metas],
    [['calendario', 'fases'], plano.calendario.fases],
    [['riscos_e_regras', 'riscos'], plano.riscos_e_regras.riscos],
    [['riscos_e_regras', 'regras_aplicaveis'], plano.riscos_e_regras.regras_aplicaveis],
    [['riscos_e_regras', 'limites_do_cliente'], plano.riscos_e_regras.limites_do_cliente],
    [['lacunas', 'itens'], plano.lacunas.itens],
  ];
  for (const [caminho, itens] of colecoes) {
    for (const repetido of idsRepetidos(itens.map((item) => item.id))) registrar(caminho, `Id repetido: ${repetido}.`);
  }

  const segmentos = new Set(plano.publico_alvo.segmentos.map((s) => s.id));
  const conceitos = new Set(plano.criativos.conceitos.map((c) => c.id));
  const canais = new Set(plano.canais_e_plataformas.canais.map((c) => c.id));
  const hipoteses = new Set(plano.estrategia.hipoteses.map((h) => h.id));
  const metas = new Map(plano.metas_e_metricas.metas.map((m) => [m.id, m]));

  plano.comunidades_alvo.comunidades.forEach((c, i) => {
    if (c.segmento_id !== undefined && !segmentos.has(c.segmento_id)) {
      registrar(['comunidades_alvo', 'comunidades', i, 'segmento_id'], `Segmento inexistente: ${c.segmento_id}.`);
    }
  });
  plano.estrategia.nao_faremos.forEach((n, i) => {
    if (n.teste?.tipo === 'publico_proibido' && !segmentos.has(n.teste.valor)) {
      registrar(['estrategia', 'nao_faremos', i, 'teste', 'valor'], `Segmento inexistente: ${n.teste.valor}.`);
    }
  });
  plano.campanhas.campanhas.forEach((c, i) => {
    if (!segmentos.has(c.segmento_id)) registrar(['campanhas', 'campanhas', i, 'segmento_id'], `Segmento inexistente: ${c.segmento_id}.`);
    if (!conceitos.has(c.conceito_id)) registrar(['campanhas', 'campanhas', i, 'conceito_id'], `Conceito inexistente: ${c.conceito_id}.`);
    if (!metas.has(c.meta_id)) registrar(['campanhas', 'campanhas', i, 'meta_id'], `Meta inexistente: ${c.meta_id}.`);
  });
  plano.criativos.conceitos.forEach((c, i) => {
    if (c.hipotese_id !== undefined && !hipoteses.has(c.hipotese_id)) {
      registrar(['criativos', 'conceitos', i, 'hipotese_id'], `Hipótese inexistente: ${c.hipotese_id}.`);
    }
  });
  plano.orcamento.por_canal.forEach((p, i) => {
    if (!canais.has(p.canal_id)) registrar(['orcamento', 'por_canal', i, 'canal_id'], `Canal inexistente: ${p.canal_id}.`);
  });
  plano.metas_e_metricas.metas.forEach((m, i) => {
    if (m.nivel === 'negocio' && m.pai_id !== null) {
      registrar(['metas_e_metricas', 'metas', i, 'pai_id'], 'Meta de negócio não tem pai.');
    }
    if (m.nivel === 'canal' && (m.pai_id === null || metas.get(m.pai_id)?.nivel !== 'negocio')) {
      registrar(['metas_e_metricas', 'metas', i, 'pai_id'], 'Meta de canal aponta para uma meta de negócio.');
    }
  });
  plano.medicao.itens.forEach((item, i) => {
    if (!metas.has(item.meta_id)) registrar(['medicao', 'itens', i, 'meta_id'], `Meta inexistente: ${item.meta_id}.`);
  });
  return problemas;
}

export const esquemaPlano = z
  .strictObject({ schema_version: z.literal(SCHEMA_VERSION), ...secoesDoPlano })
  .superRefine((plano, contexto) => {
    for (const problema of problemasDeIntegridade(plano)) {
      contexto.addIssue({ code: 'custom', path: problema.caminho, message: problema.mensagem });
    }
  });
export type Plano = z.infer<typeof esquemaPlano>;

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
