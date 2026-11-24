import { textoSeguro } from './privacidade.ts';

export type NaturezaDaRegra = 'limite' | 'regra' | 'decisao';
export type StatusDaDecisao = 'proposta' | 'vigente' | 'superada' | 'revogada' | 'rejeitada';

export type ValorDoLimite =
  | { readonly unidade: 'brl_centavos'; readonly centavos: string; readonly moeda: 'BRL' }
  | { readonly unidade: 'razao' | 'percentual'; readonly decimal: string };

export type DefinicaoParaCatalogo = {
  readonly chave: string;
  readonly versao: number;
  readonly nome: string;
  readonly categoria: string;
  readonly unidade: string;
  readonly periodo: string;
  readonly sentido: string;
  readonly escoposAceitos: readonly string[];
  readonly essencial: boolean;
  readonly ativo: boolean;
};

export type DecisaoParaCatalogo = {
  readonly numero: number;
  readonly categoria: string;
  readonly natureza: NaturezaDaRegra;
  readonly origem: string;
  readonly forca: string;
  readonly chave: string | null;
  readonly escopo: string;
  readonly titulo: string;
  readonly contexto: string | null;
  readonly texto: string | null;
  readonly valor: ValorDoLimite | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly status: StatusDaDecisao;
  readonly vigente: boolean;
  readonly substituiNumero: number | null;
  readonly substituidaPorNumero: number | null;
  readonly definicaoChave: string | null;
  readonly definicaoVersao: number | null;
  readonly registradaEmNomeDeTerceiro: boolean;
  readonly decididaPorPessoa: boolean;
  readonly semConfirmacaoDoAnunciante: boolean;
  readonly aRevisar: boolean;
  readonly criadaEm: string;
};

export type RegrasParaCatalogo = {
  readonly definicoes: readonly DefinicaoParaCatalogo[];
  readonly decisoes: readonly DecisaoParaCatalogo[];
  readonly conflitos: number;
  readonly truncado: boolean;
};

export type EscopoDeRegras = { readonly organizationId: string; readonly clientId: string };

export type CarregadorDeRegras = {
  readonly disponivel: boolean;
  carregar(escopo: EscopoDeRegras): Promise<RegrasParaCatalogo | null>;
};

export const CARREGADOR_DE_REGRAS_INDISPONIVEL: CarregadorDeRegras = {
  disponivel: false,
  carregar: () => Promise.resolve(null),
};

export const LIMITE_DE_DECISOES_NO_CATALOGO = 1000;
export const ARQUIVO_DE_REGRAS = 'regras.md';
export const ARQUIVO_DE_DECISOES = 'decisoes.jsonl';

export function prefixoDoBrain(organizationId: string, clientId: string): string {
  return `orgs/${organizationId}/clientes/${clientId}/brain/`;
}

function sufixoDoEscopo(escopo: string): string {
  return escopo.replace(':', '-');
}

export function idDoLimite(chave: string, escopo: string): string {
  return `${chave}--${sufixoDoEscopo(escopo)}`;
}

export function idDaRegra(chave: string, escopo: string): string {
  return escopo === 'cliente' ? chave : `${chave}--${sufixoDoEscopo(escopo)}`;
}

export function idDaDecisao(numero: number): string {
  return String(numero);
}

function agruparMilhares(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatarValorDoLimite(valor: ValorDoLimite): string {
  if (valor.unidade === 'brl_centavos') {
    const completo = BigInt(valor.centavos).toString().padStart(3, '0');
    return `R$ ${agruparMilhares(completo.slice(0, -2))},${completo.slice(-2)}`;
  }
  const [inteiro = '0', fracao] = valor.decimal.split('.');
  const texto = fracao === undefined ? agruparMilhares(inteiro) : `${agruparMilhares(inteiro)},${fracao}`;
  return valor.unidade === 'percentual' ? `${texto}%` : `${texto}x`;
}

export type LacunaEssencial = { readonly chave: string; readonly nome: string };

export function definicoesVigentesDoCatalogo(definicoes: readonly DefinicaoParaCatalogo[]): readonly DefinicaoParaCatalogo[] {
  const ultima = new Map<string, DefinicaoParaCatalogo>();
  for (const definicao of definicoes) {
    const atual = ultima.get(definicao.chave);
    if (!atual || definicao.versao > atual.versao) ultima.set(definicao.chave, definicao);
  }
  return [...ultima.values()].sort((a, b) => a.chave.localeCompare(b.chave));
}

export function lacunasEssenciais(regras: RegrasParaCatalogo): readonly LacunaEssencial[] {
  const comLimiteVigente = new Set(
    regras.decisoes.filter((d) => d.natureza === 'limite' && d.vigente && d.chave !== null).map((d) => d.chave as string),
  );
  return definicoesVigentesDoCatalogo(regras.definicoes)
    .filter((definicao) => definicao.essencial && definicao.ativo && !comLimiteVigente.has(definicao.chave))
    .map((definicao) => ({ chave: definicao.chave, nome: definicao.nome }));
}

export function propostasPendentes(regras: RegrasParaCatalogo): number {
  return regras.decisoes.filter((d) => d.status === 'proposta').length;
}

export function sanearRegras(regras: RegrasParaCatalogo): RegrasParaCatalogo {
  const limpar = (texto: string | null): string | null => (texto === null ? null : textoSeguro(texto));
  return {
    ...regras,
    decisoes: regras.decisoes.map((d) => ({
      ...d,
      titulo: textoSeguro(d.titulo),
      contexto: limpar(d.contexto),
      texto: limpar(d.texto),
    })),
  };
}
