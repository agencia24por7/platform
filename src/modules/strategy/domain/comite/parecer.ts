import { z } from 'zod';
import { err, ok, type Result } from '../../../../shared/result/result.ts';
import { lerUrn } from '../../../brain/domain/urn.ts';
import { esquemaId } from '../plano.ts';
import { PADRAO_DA_CHAVE_DA_PERSONA } from './personas.ts';

export const VEREDITOS = ['aprova', 'aprova_com_ajuste', 'reprova'] as const;
export type Veredito = (typeof VEREDITOS)[number];

export const TAMANHO_MAXIMO_DO_PARECER_BYTES = 16384;
export const MAXIMO_DE_PONTOS_POR_PARECER = 5;

const texto = (maximo: number) => z.string().min(1).max(maximo).regex(/\S/, 'Texto não pode ser vazio.');

export const PADRAO_DO_TRECHO = /^[a-z][a-z0-9_]{0,47}(\/[a-z][a-z0-9_]{0,31})?$/;

export const esquemaPontoDoParecer = z.strictObject({
  id: esquemaId,
  trecho: z.string().regex(PADRAO_DO_TRECHO, 'Trecho é seção ou seção/id do item.'),
  problema: texto(500),
  ajustePedido: texto(500),
  fontes: z
    .array(z.string().max(320).refine((urn) => lerUrn(urn) !== null, 'URN inválida.'))
    .max(10),
});
export type PontoDoParecer = z.infer<typeof esquemaPontoDoParecer>;

export function tamanhoDoParecer(parecer: unknown): number {
  return new TextEncoder().encode(JSON.stringify(parecer)).length;
}

export const esquemaParecer = z
  .strictObject({
    persona: z.string().regex(PADRAO_DA_CHAVE_DA_PERSONA),
    veredito: z.enum(VEREDITOS),
    motivo: texto(800),
    pontos: z.array(esquemaPontoDoParecer).max(MAXIMO_DE_PONTOS_POR_PARECER),
  })
  .superRefine((parecer, contexto) => {
    const ids = parecer.pontos.map((ponto) => ponto.id);
    if (new Set(ids).size !== ids.length) {
      contexto.addIssue({ code: 'custom', path: ['pontos'], message: 'Ids de pontos repetidos.' });
    }
    if (parecer.veredito !== 'aprova' && parecer.pontos.length === 0) {
      contexto.addIssue({ code: 'custom', path: ['pontos'], message: 'Parecer que pede ajuste ou reprova aponta ao menos um ponto.' });
    }
    if (tamanhoDoParecer(parecer) > TAMANHO_MAXIMO_DO_PARECER_BYTES) {
      contexto.addIssue({ code: 'custom', message: `Parecer acima de ${TAMANHO_MAXIMO_DO_PARECER_BYTES} bytes.` });
    }
  });
export type Parecer = z.infer<typeof esquemaParecer>;

export type ErroDoParecer = {
  readonly codigo: 'parecer_invalido';
  readonly problemas: readonly { readonly caminho: string; readonly mensagem: string }[];
};

export function lerParecer(json: unknown): Result<Parecer, ErroDoParecer> {
  const resultado = esquemaParecer.safeParse(json);
  if (resultado.success) return ok(resultado.data);
  return err({
    codigo: 'parecer_invalido',
    problemas: resultado.error.issues.slice(0, 30).map((p) => ({ caminho: p.path.join('.'), mensagem: p.message })),
  });
}
