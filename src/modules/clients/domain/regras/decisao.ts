import { z } from 'zod';
import { CATEGORIAS, ehCategoriaDeLimite } from './categoria.ts';
import { ChaveSchema, EscopoSchema, ESCOPO_DO_CLIENTE } from './definicaoDeLimite.ts';
import { FORCAS } from './forca.ts';
import { NATUREZAS } from './natureza.ts';
import { ORIGENS } from './origem.ts';
import { STATUS } from './status.ts';
import { ValorSchema } from './valor.ts';

export const LIMITES_DE_TAMANHO = {
  titulo: 120,
  contexto: 2000,
  texto: 4000,
  evidencia: 500,
  motivo: 500,
  identificador: 120,
} as const;

const textoCurto = (maximo: number) => z.string().trim().min(1).max(maximo);

export const DecisaoSchema = z
  .object({
    id: textoCurto(LIMITES_DE_TAMANHO.identificador),
    clienteId: textoCurto(LIMITES_DE_TAMANHO.identificador),
    numero: z.number().int().min(1),
    categoria: z.enum(CATEGORIAS),
    natureza: z.enum(NATUREZAS),
    origem: z.enum(ORIGENS),
    forca: z.enum(FORCAS),
    chave: ChaveSchema.nullable(),
    escopo: EscopoSchema.default(ESCOPO_DO_CLIENTE),
    titulo: textoCurto(LIMITES_DE_TAMANHO.titulo),
    contexto: z.string().trim().max(LIMITES_DE_TAMANHO.contexto).nullable(),
    texto: z.string().trim().max(LIMITES_DE_TAMANHO.texto).nullable(),
    valor: ValorSchema.nullable(),
    vigenciaInicio: z.date(),
    vigenciaFim: z.date().nullable(),
    status: z.enum(STATUS),
    supersedesId: textoCurto(LIMITES_DE_TAMANHO.identificador).nullable(),
    decididoPor: textoCurto(LIMITES_DE_TAMANHO.identificador).nullable(),
    emNomeDe: textoCurto(LIMITES_DE_TAMANHO.identificador).nullable(),
    evidencia: z.string().trim().max(LIMITES_DE_TAMANHO.evidencia).nullable(),
    semConfirmacaoDoAnunciante: z.boolean(),
    viaLinkId: textoCurto(LIMITES_DE_TAMANHO.identificador).nullable(),
    agentId: textoCurto(LIMITES_DE_TAMANHO.identificador).nullable(),
    agentRunId: textoCurto(LIMITES_DE_TAMANHO.identificador).nullable(),
    agentSetHash: textoCurto(LIMITES_DE_TAMANHO.identificador).nullable(),
    chaveDeIdempotencia: textoCurto(LIMITES_DE_TAMANHO.identificador).nullable(),
    definicaoChave: ChaveSchema.nullable(),
    definicaoVersao: z.number().int().min(1).nullable(),
    revisarEConverterEmLimite: z.boolean(),
    motivoDaRevogacao: textoCurto(LIMITES_DE_TAMANHO.motivo).nullable(),
    criadoEm: z.date(),
  })
  .strict()
  .superRefine((decisao, contexto) => {
    const falha = (path: string, message: string) => contexto.addIssue({ code: 'custom', path: [path], message });

    if (decisao.natureza === 'limite') {
      if (!ehCategoriaDeLimite(decisao.categoria)) falha('categoria', 'Limite só existe em investimento ou eficiencia.');
      if (decisao.chave === null) falha('chave', 'Limite exige chave.');
      if (decisao.valor === null) falha('valor', 'Limite exige valor.');
      if (decisao.definicaoChave === null || decisao.definicaoVersao === null) {
        falha('definicaoChave', 'Limite exige a definição e a versão.');
      }
      if (decisao.definicaoChave !== null && decisao.definicaoChave !== decisao.chave) {
        falha('definicaoChave', 'A definição deve ter a mesma chave do limite.');
      }
    }
    if (decisao.natureza === 'regra') {
      if (decisao.chave === null) falha('chave', 'Regra exige chave.');
      if (decisao.texto === null) falha('texto', 'Regra exige texto.');
    }
    if (decisao.natureza !== 'limite' && decisao.valor !== null) {
      falha('valor', 'Só limite carrega valor.');
    }
    if (decisao.origem === 'agente' && (decisao.agentId === null || decisao.agentRunId === null)) {
      falha('agentId', 'Origem agente exige agentId e agentRunId.');
    }
    if (decisao.status === 'revogada' && decisao.motivoDaRevogacao === null) {
      falha('motivoDaRevogacao', 'Revogada exige motivo.');
    }
    if (decisao.vigenciaFim !== null && decisao.vigenciaFim.getTime() <= decisao.vigenciaInicio.getTime()) {
      falha('vigenciaFim', 'O fim da vigência deve vir depois do início.');
    }
  });
export type Decisao = z.infer<typeof DecisaoSchema>;
