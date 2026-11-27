import { z } from 'zod';
import { TIPOS_DE_PLANO, esquemaIntencao } from '@/modules/strategy/domain/index';

export const TAMANHO_MAXIMO_DA_INSTRUCAO = 2000;
export const TAMANHO_MAXIMO_DO_PEDIDO_BYTES = 7000;

const identificador = z.string().uuid();

export const PedirPlanoSchema = z
  .strictObject({
    clienteId: identificador,
    tipoDePlano: z.enum(TIPOS_DE_PLANO),
    intencao: esquemaIntencao,
  })
  .refine(
    (entrada) => new TextEncoder().encode(JSON.stringify(entrada.intencao)).length <= TAMANHO_MAXIMO_DO_PEDIDO_BYTES,
    { path: ['intencao'], message: 'Intenção grande demais.' },
  );
export type EntradaDePedirPlano = z.input<typeof PedirPlanoSchema>;

export const PedirMudancaSchema = z.strictObject({
  planoId: identificador,
  instrucao: z.string().trim().min(3, 'Descreva a mudança (mínimo 3 caracteres).').max(TAMANHO_MAXIMO_DA_INSTRUCAO),
});
export type EntradaDePedirMudanca = z.input<typeof PedirMudancaSchema>;

export const PedirRevisaoSchema = z.strictObject({ planoId: identificador });
export type EntradaDePedirRevisao = z.input<typeof PedirRevisaoSchema>;

export const LIMITE_PADRAO_DE_EXECUCOES = 10;
export const LIMITE_MAXIMO_DE_EXECUCOES = 50;

export const AvancarExecucoesSchema = z.strictObject({
  limite: z.number().int().min(1).max(LIMITE_MAXIMO_DE_EXECUCOES).default(LIMITE_PADRAO_DE_EXECUCOES),
});
export type EntradaDeAvancarExecucoes = z.input<typeof AvancarExecucoesSchema>;

export const EditarManualSchema = z.strictObject({ planoId: identificador, conteudo: z.unknown() });
export type EntradaDeEditarManual = z.input<typeof EditarManualSchema>;

export const VersaoAlvoSchema = z.strictObject({ versaoId: identificador });
export type EntradaDeVersaoAlvo = z.input<typeof VersaoAlvoSchema>;

export const ExecucaoAlvoSchema = z.strictObject({ execucaoId: identificador });
export type EntradaDeExecucaoAlvo = z.input<typeof ExecucaoAlvoSchema>;

export const PainelSchema = z.strictObject({ clienteId: identificador, planoId: identificador.optional(), tipo: z.enum(TIPOS_DE_PLANO).optional() });
export type EntradaDoPainel = z.input<typeof PainelSchema>;

export function detalhesDoZod(erro: z.ZodError): Record<string, string> {
  const detalhes: Record<string, string> = {};
  for (const problema of erro.issues) {
    const caminho = problema.path.length > 0 ? problema.path.join('.') : 'entrada';
    detalhes[caminho] ??= problema.message;
  }
  return detalhes;
}
