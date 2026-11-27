import { z } from 'zod';
import { ValorSchema } from '@/modules/clients/domain/regras/valor';
import { TIPOS_DE_PLANO, dataIsoValida, esquemaId, esquemaIntencaoBase, esquemaPlataformasDoPedido } from '@/modules/strategy/domain/index';

export const TAMANHO_MAXIMO_DA_INSTRUCAO = 2000;
export const TAMANHO_MAXIMO_DO_PEDIDO_BYTES = 7000;

const identificador = z.string().uuid();

const corpoDoPedido = {
  clienteId: identificador,
  tipoDePlano: z.enum(TIPOS_DE_PLANO),
  plataformas: esquemaPlataformasDoPedido,
  landingPageId: identificador,
};

export const PedirPlanoSchema = z
  .strictObject({ ...corpoDoPedido, intencao: esquemaIntencaoBase, chaveDeIdempotencia: z.string().uuid().optional() })
  .refine(
    (entrada) => new TextEncoder().encode(JSON.stringify(entrada.intencao)).length <= TAMANHO_MAXIMO_DO_PEDIDO_BYTES,
    { path: ['intencao'], message: 'Intenção grande demais.' },
  );
export type EntradaDePedirPlano = z.input<typeof PedirPlanoSchema>;

export const PreviaDeUtmSchema = z.strictObject({
  ...corpoDoPedido,
  nomeDaCampanha: z.string().trim().min(3, 'Descreva o objetivo (mínimo 3 caracteres).').max(600),
  inicio: z.string().refine(dataIsoValida, 'Informe uma data válida.'),
});
export type EntradaDaPreviaDeUtm = z.input<typeof PreviaDeUtmSchema>;

export const EscopoDoClienteSchema = z.strictObject({ clienteId: identificador });
export type EntradaDoEscopoDoCliente = z.input<typeof EscopoDoClienteSchema>;

export const PedirMudancaSchema = z.strictObject({
  planoId: identificador,
  instrucao: z.string().trim().min(3, 'Descreva a mudança (mínimo 3 caracteres).').max(TAMANHO_MAXIMO_DA_INSTRUCAO),
});
export type EntradaDePedirMudanca = z.input<typeof PedirMudancaSchema>;

export const CorrigirFalhaDoGateSchema = z.strictObject({ clienteId: identificador, planoId: identificador });
export type EntradaDeCorrigirFalhaDoGate = z.input<typeof CorrigirFalhaDoGateSchema>;

export const TentarDeNovoSchema = z.strictObject({ clienteId: identificador, planoId: identificador });
export type EntradaDeTentarDeNovo = z.input<typeof TentarDeNovoSchema>;

export const MAXIMO_DE_ITENS_DAS_SUGESTOES = 30;

export const AprovarSugestoesSchema = z.strictObject({
  clienteId: identificador,
  planoId: identificador,
  itens: z
    .array(
      z.strictObject({
        lacunaId: esquemaId,
        valor: z.union([ValorSchema, z.strictObject({ texto: z.string().trim().min(1).max(400) })]).optional(),
      }),
    )
    .min(1)
    .max(MAXIMO_DE_ITENS_DAS_SUGESTOES),
});
export type EntradaDeAprovarSugestoes = z.input<typeof AprovarSugestoesSchema>;

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

export const PainelSchema = z.strictObject({ clienteId: identificador, planoId: identificador.optional() });
export type EntradaDoPainel = z.input<typeof PainelSchema>;

export function detalhesDoZod(erro: z.ZodError): Record<string, string> {
  const detalhes: Record<string, string> = {};
  for (const problema of erro.issues) {
    const caminho = problema.path.length > 0 ? problema.path.join('.') : 'entrada';
    detalhes[caminho] ??= problema.message;
  }
  return detalhes;
}
