import { z } from 'zod';
import { esquemaData } from '../datas.ts';
import { esquemaDinheiro } from '../dinheiro.ts';
import { PAPEIS_DA_EVIDENCIA, esquemaChaveDeCampo, esquemaId, esquemaUrn } from '../plano.ts';

export const SCHEMA_VERSION_DA_PRODUCAO = 1;
export const TAMANHO_MAXIMO_DA_CAMPANHA_BYTES = 48_000;
export const TAMANHO_MAXIMO_DO_PLANO_DE_PRODUCAO_BYTES = 240_000;

export const TIPOS_DE_ENTREGAVEL = ['copy', 'imagem', 'carrossel', 'video'] as const;
export type TipoDeEntregavel = (typeof TIPOS_DE_ENTREGAVEL)[number];

export const TIPOS_DE_PROMPT = ['copy', 'imagem', 'video'] as const;
export const USOS_DA_REFERENCIA = ['inspiracao', 'evitar', 'prova'] as const;
export type UsoDaReferencia = (typeof USOS_DA_REFERENCIA)[number];

export const CATEGORIAS_DE_FERRAMENTA = ['copy', 'imagem', 'video', 'audio', 'edicao', 'design', 'aprovacao', 'gestao'] as const;

export const PAPEIS_DE_PRODUCAO = [
  'redator',
  'diretor_de_arte',
  'designer',
  'editor_de_video',
  'produtor',
  'gestor_de_trafego',
  'revisor_legal',
  'aprovador_do_cliente',
  'atendimento',
] as const;
export type PapelDeProducao = (typeof PAPEIS_DE_PRODUCAO)[number];

const texto = (maximo: number) => z.string().min(1).max(maximo).regex(/\S/, 'Texto não pode ser vazio.');
const lista = <T extends z.ZodType>(item: T, maximo: number) => z.array(item).max(maximo);

const esquemaEvidencia = z.strictObject({ urn: esquemaUrn, papel: z.enum(PAPEIS_DA_EVIDENCIA) });

const esquemaEspecificacao = z.discriminatedUnion('origem', [
  z.strictObject({ origem: z.literal('catalogo'), campos: z.array(esquemaChaveDeCampo).min(1).max(5) }),
  z.strictObject({ origem: z.literal('a_confirmar'), motivo: texto(300) }),
]);

const esquemaTextoDoEntregavel = z.strictObject({ campo: esquemaChaveDeCampo.nullable(), texto: texto(600) });

const esquemaCena = z.strictObject({
  ordem: z.number().int().min(1).max(30),
  cena: texto(400),
  texto_em_tela: texto(200).nullable(),
  audio: texto(300).nullable(),
  duracao_segundos: z.number().int().min(1).max(600).nullable(),
});

const esquemaPrompt = z.strictObject({ tipo: z.enum(TIPOS_DE_PROMPT), prompt: texto(2000) });

const esquemaReferencia = z.strictObject({ urn: esquemaUrn, uso: z.enum(USOS_DA_REFERENCIA), motivo: texto(200) });

const esquemaEntregavel = z.strictObject({
  id: esquemaId,
  nome: texto(120),
  tipo: z.enum(TIPOS_DE_ENTREGAVEL),
  especificacao: esquemaEspecificacao,
  proporcao: z.string().regex(/^\d{1,2}(\.\d{1,2})?:\d{1,2}$/).nullable(),
  duracao_segundos: z.number().int().min(1).max(600).nullable(),
  textos: lista(esquemaTextoDoEntregavel, 30),
  roteiro: lista(esquemaCena, 15),
  prompts: z.array(esquemaPrompt).min(1).max(5),
  referencias: lista(esquemaReferencia, 8),
  justificativa: texto(400),
  evidencias: lista(esquemaEvidencia, 5),
  hipotese: z.boolean(),
});
export type Entregavel = z.infer<typeof esquemaEntregavel>;

const esquemaFerramenta = z.strictObject({
  categoria: z.enum(CATEGORIAS_DE_FERRAMENTA),
  papel: z.enum(PAPEIS_DE_PRODUCAO),
  ferramenta: texto(80),
  justificativa: texto(300),
});
export type Ferramenta = z.infer<typeof esquemaFerramenta>;

const esquemaValorDoCusto = z.discriminatedUnion('origem', [
  z.strictObject({ origem: z.literal('verba_da_campanha'), valor: esquemaDinheiro }),
  z.strictObject({ origem: z.literal('a_confirmar'), motivo: texto(300) }),
]);

const esquemaCusto = z.strictObject({
  id: esquemaId,
  descricao: texto(200),
  entregavel_ids: lista(esquemaId, 12),
  valor: esquemaValorDoCusto,
  justificativa: texto(300),
});
export type Custo = z.infer<typeof esquemaCusto>;

const esquemaEtapa = z.strictObject({
  id: esquemaId,
  etapa: texto(160),
  papel: z.enum(PAPEIS_DE_PRODUCAO),
  entregavel_ids: z.array(esquemaId).min(1).max(12),
  inicio: esquemaData,
  fim: esquemaData,
  depende_de: lista(esquemaId, 10),
});
export type EtapaDoWorkflow = z.infer<typeof esquemaEtapa>;

const esquemaLacuna = z.strictObject({ id: esquemaId, descricao: texto(400), impacto: texto(300) });
export type LacunaDaProducao = z.infer<typeof esquemaLacuna>;

export const esquemaProducaoDaCampanha = z.strictObject({
  campanha_id: esquemaId,
  conceito: texto(600),
  entregaveis: z.array(esquemaEntregavel).min(1).max(12),
  ferramentas: lista(esquemaFerramenta, 10),
  custos: lista(esquemaCusto, 20),
  workflow: z.array(esquemaEtapa).min(1).max(30),
  lacunas: lista(esquemaLacuna, 10),
});
export type ProducaoDaCampanha = z.infer<typeof esquemaProducaoDaCampanha>;

const esquemaReferenciaGravada = z.strictObject({
  urn: esquemaUrn,
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  tipo: z.string().min(1).max(64),
  titulo: z.string().min(1).max(160),
});
export type ReferenciaGravada = z.infer<typeof esquemaReferenciaGravada>;

export const esquemaPlanoDeProducao = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION_DA_PRODUCAO),
  janela: z.strictObject({ inicio: esquemaData, fim: esquemaData }),
  campanhas: z.array(esquemaProducaoDaCampanha).min(1).max(30),
  referencias: lista(esquemaReferenciaGravada, 400),
});
export type PlanoDeProducao = z.infer<typeof esquemaPlanoDeProducao>;

export function tamanhoEmBytes(valor: unknown): number {
  return new TextEncoder().encode(JSON.stringify(valor)).length;
}
