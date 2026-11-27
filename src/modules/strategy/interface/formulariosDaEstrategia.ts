import { z } from 'zod';
import { err, ok, type Result } from '../../../shared/result/result.ts';
import { dataIsoValida } from '../domain/datas.ts';
import { OUSADIAS, SECOES_DO_PLANO, TAMANHO_MAXIMO_DO_PLANO_BYTES, type SecaoDoPlano } from '../domain/plano.ts';
import { TIPOS_DE_PLANO, type TipoDePlano } from '../domain/tipoDePlano.ts';
import { centavosDeReais } from './formatosDoPlano.ts';

export type CamposBrutos = Readonly<Record<string, string | undefined>>;
export type ErrosDeCampo = Readonly<Record<string, string>>;

export const TAMANHO_MAXIMO_DA_INSTRUCAO_NA_TELA = 2000;
export const TAMANHO_MAXIMO_DO_JSON_DA_SECAO = TAMANHO_MAXIMO_DO_PLANO_BYTES;

const identificador = z.string().uuid('Identificador inválido.');

const esquemaDoId = (chave: string) => z.strictObject({ [chave]: identificador });

export function lerIdDoCampo(campos: CamposBrutos, chave: string): Result<string, ErrosDeCampo> {
  const lido = esquemaDoId(chave).safeParse({ [chave]: campos[chave] ?? '' });
  return lido.success ? ok(lido.data[chave] as string) : err({ [chave]: 'Identificador inválido.' });
}

export type IntencaoDoFormulario = {
  readonly tipoDePlano: TipoDePlano;
  readonly intencao: {
    readonly objetivo: string;
    readonly horizonte: { readonly inicio: string; readonly fim: string };
    readonly ousadia: (typeof OUSADIAS)[number];
    readonly retorno_esperado: { readonly descricao: string };
    readonly verba: { readonly centavos: string; readonly moeda: 'BRL' };
  };
};

const esquemaDaData = z.string().refine(dataIsoValida, 'Informe uma data válida.');

export function lerIntencaoDoFormulario(campos: CamposBrutos): Result<IntencaoDoFormulario, ErrosDeCampo> {
  const erros: Record<string, string> = {};
  const aparado = (chave: string) => (campos[chave] ?? '').trim();

  const tipo = z.enum(TIPOS_DE_PLANO).safeParse(aparado('tipoDePlano'));
  if (!tipo.success) erros['tipoDePlano'] = 'Escolha o tipo de plano.';

  const objetivo = aparado('objetivo');
  if (objetivo.length < 3) erros['objetivo'] = 'Descreva o objetivo (mínimo 3 caracteres).';
  else if (objetivo.length > 600) erros['objetivo'] = 'O objetivo pode ter no máximo 600 caracteres.';

  const inicio = esquemaDaData.safeParse(aparado('inicio'));
  if (!inicio.success) erros['inicio'] = 'Informe a data de início.';
  const fim = esquemaDaData.safeParse(aparado('fim'));
  if (!fim.success) erros['fim'] = 'Informe a data de fim.';
  if (inicio.success && fim.success && inicio.data > fim.data) erros['fim'] = 'O fim não pode ser antes do início.';

  const ousadia = z.enum(OUSADIAS).safeParse(aparado('ousadia'));
  if (!ousadia.success) erros['ousadia'] = 'Escolha o nível de ousadia.';

  const retorno = aparado('retorno');
  if (retorno.length < 3) erros['retorno'] = 'Descreva o retorno esperado (mínimo 3 caracteres).';
  else if (retorno.length > 400) erros['retorno'] = 'O retorno esperado pode ter no máximo 400 caracteres.';

  const centavos = centavosDeReais(aparado('verba'));
  if (centavos === null) erros['verba'] = 'Informe a verba em reais, por exemplo 15.000,00.';
  else if (BigInt(centavos) <= 0n) erros['verba'] = 'A verba precisa ser maior que zero.';

  if (Object.keys(erros).length > 0 || !tipo.success || !inicio.success || !fim.success || !ousadia.success || centavos === null) return err(erros);

  return ok({
    tipoDePlano: tipo.data,
    intencao: {
      objetivo,
      horizonte: { inicio: inicio.data, fim: fim.data },
      ousadia: ousadia.data,
      retorno_esperado: { descricao: retorno },
      verba: { centavos, moeda: 'BRL' },
    },
  });
}

export function lerPedidoDeMudanca(campos: CamposBrutos): Result<{ readonly planoId: string; readonly versaoId: string; readonly instrucao: string }, ErrosDeCampo> {
  const lido = z
    .strictObject({
      planoId: identificador,
      versaoId: identificador,
      instrucao: z.string().trim().min(3, 'Descreva a mudança (mínimo 3 caracteres).').max(TAMANHO_MAXIMO_DA_INSTRUCAO_NA_TELA, `A mudança pode ter no máximo ${TAMANHO_MAXIMO_DA_INSTRUCAO_NA_TELA} caracteres.`),
    })
    .safeParse({ planoId: campos['planoId'] ?? '', versaoId: campos['versaoId'] ?? '', instrucao: campos['instrucao'] ?? '' });
  if (lido.success) return ok(lido.data);
  const erros: Record<string, string> = {};
  for (const problema of lido.error.issues) erros[String(problema.path[0] ?? 'instrucao')] ??= problema.message;
  return err(erros);
}

export type EdicaoDeSecao = { readonly planoId: string; readonly versaoId: string; readonly secao: SecaoDoPlano; readonly valor: unknown };

export function lerEdicaoDeSecao(campos: CamposBrutos): Result<EdicaoDeSecao, ErrosDeCampo> {
  const planoId = lerIdDoCampo(campos, 'planoId');
  if (!planoId.ok) return err({ planoId: 'Plano inválido.' });
  const versaoId = lerIdDoCampo(campos, 'versaoId');
  if (!versaoId.ok) return err({ versaoId: 'Versão inválida.' });
  const secao = z.enum(SECOES_DO_PLANO).safeParse(campos['secao'] ?? '');
  if (!secao.success) return err({ secao: 'Seção desconhecida.' });
  const bruto = campos['json'] ?? '';
  if (bruto.trim() === '') return err({ json: 'O conteúdo da seção não pode ficar vazio.' });
  if (new TextEncoder().encode(bruto).length > TAMANHO_MAXIMO_DO_JSON_DA_SECAO) return err({ json: 'O conteúdo da seção é grande demais.' });
  try {
    return ok({ planoId: planoId.value, versaoId: versaoId.value, secao: secao.data, valor: JSON.parse(bruto) as unknown });
  } catch {
    return err({ json: 'O texto não é um JSON válido. Confira vírgulas, aspas e chaves.' });
  }
}

export function trocarSecao(conteudo: unknown, secao: SecaoDoPlano, valor: unknown): Record<string, unknown> | null {
  if (typeof conteudo !== 'object' || conteudo === null || Array.isArray(conteudo)) return null;
  return { ...(conteudo as Record<string, unknown>), [secao]: valor };
}
