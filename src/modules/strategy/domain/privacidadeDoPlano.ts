import { err, ok, type Result } from '../../../shared/result/result.ts';
import { TEXTO_OMITIDO, procurarPii, textoSeguro } from '../../brain/domain/privacidade.ts';
import type { RespostaDoAjuste } from './comite/ajuste.ts';
import type { Parecer } from './comite/parecer.ts';
import type { Intencao } from './plano.ts';

export type TextoDoPlano = { readonly caminho: string; readonly texto: string };

export type DadoPessoalNoPlano = {
  readonly secao: string;
  readonly caminho: string;
  readonly padroes: readonly string[];
};

export type CampoDeIntencaoInvalido = { readonly campo: string; readonly motivo: 'dado_pessoal_ou_vazio' };

const LIMITE_DE_PROFUNDIDADE = 12;

export function textosDoPlano(valor: unknown, prefixo = '', profundidade = 0): TextoDoPlano[] {
  if (profundidade > LIMITE_DE_PROFUNDIDADE) return [];
  if (typeof valor === 'string') return [{ caminho: prefixo, texto: valor }];
  if (Array.isArray(valor)) return valor.flatMap((item, indice) => textosDoPlano(item, `${prefixo}[${indice}]`, profundidade + 1));
  if (valor !== null && typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>).flatMap(([chave, filho]) =>
      textosDoPlano(filho, prefixo === '' ? chave : `${prefixo}.${chave}`, profundidade + 1),
    );
  }
  return [];
}

export function secaoDoCaminho(caminho: string): string {
  return caminho.split(/[.[]/)[0] ?? caminho;
}

export function planoSemDadoPessoal(plano: unknown): Result<true, DadoPessoalNoPlano[]> {
  const achados: DadoPessoalNoPlano[] = [];
  for (const { caminho, texto } of textosDoPlano(plano)) {
    const padroes = [...new Set(procurarPii(texto).map((achado) => achado.padrao))];
    if (padroes.length > 0) achados.push({ secao: secaoDoCaminho(caminho), caminho, padroes });
  }
  return achados.length > 0 ? err(achados) : ok(true);
}

function sanitizar(texto: string): string {
  return textoSeguro(texto);
}

function campoValido(original: string, limpo: string): boolean {
  return limpo.length > 0 && limpo !== TEXTO_OMITIDO && original.trim().length > 0;
}

export function sanitizarIntencao(intencao: Intencao): Result<Intencao, CampoDeIntencaoInvalido[]> {
  const objetivo = sanitizar(intencao.objetivo);
  const descricao = sanitizar(intencao.retorno_esperado.descricao);
  const invalidos: CampoDeIntencaoInvalido[] = [];
  if (!campoValido(intencao.objetivo, objetivo)) invalidos.push({ campo: 'objetivo', motivo: 'dado_pessoal_ou_vazio' });
  if (!campoValido(intencao.retorno_esperado.descricao, descricao)) {
    invalidos.push({ campo: 'retorno_esperado.descricao', motivo: 'dado_pessoal_ou_vazio' });
  }
  if (invalidos.length > 0) return err(invalidos);
  return ok({ ...intencao, objetivo, retorno_esperado: { ...intencao.retorno_esperado, descricao } });
}

export function parecerSemDadoPessoal(parecer: Parecer): Result<true, DadoPessoalNoPlano[]> {
  return planoSemDadoPessoal({
    motivo: parecer.motivo,
    pontos: parecer.pontos.map((ponto) => ({ problema: ponto.problema, ajustePedido: ponto.ajustePedido })),
  });
}

export function respostasDoAjusteSemDadoPessoal(respostas: readonly RespostaDoAjuste[]): Result<true, DadoPessoalNoPlano[]> {
  return planoSemDadoPessoal({ respostas: respostas.map((resposta) => ({ motivo: resposta.motivo })) });
}

export function problemasDoGateSemDadoPessoal(problemas: readonly { readonly trecho: string; readonly problema: string }[]): Result<true, DadoPessoalNoPlano[]> {
  return planoSemDadoPessoal({ problemas: problemas.map((p) => ({ trecho: p.trecho, problema: p.problema })) });
}
