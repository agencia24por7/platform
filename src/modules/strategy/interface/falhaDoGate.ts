import type { MemberRole } from '../../identity/domain/user.ts';
import { falhasDoGate, podeCorrigirMais, MAXIMO_DE_CORRECOES_POR_VERSAO_RAIZ } from '../domain/correcaoDoGate.ts';
import { textoSeguro } from '../../brain/domain/privacidade.ts';
import { podeExecutar } from '../domain/papeis.ts';
import type { SecaoDoPlano } from '../domain/plano.ts';
import type { StatusDaVersao } from '../domain/status.ts';
import { ROTULO_DA_CHECAGEM, TITULO_DA_SECAO, nomeDoCampo } from './rotulosDoPlano.ts';

export type FalhaDoGateVisivel = {
  readonly gate: string;
  readonly itens: readonly string[];
};

export type FalhaDoGate = {
  readonly possivel: boolean;
  readonly motivoLegivel: string;
  readonly falhas: readonly FalhaDoGateVisivel[];
};

export type EstadoParaFalhaDoGate = {
  readonly status: StatusDaVersao | null;
  readonly resultadoDoGate: Readonly<Record<string, unknown>> | null;
  readonly execucaoAtiva: boolean;
  readonly ultimaExecucao: { readonly tipo: string; readonly status: string; readonly erroCodigo: string | null } | null;
  readonly correcoesFeitas: number;
  readonly papel: MemberRole;
};

export const ROTULO_DA_CONFERENCIA_DE_QUALIDADE = 'Coerência e plausibilidade do plano';

const ROTULOS: Readonly<Record<string, string>> = {
  ...ROTULO_DA_CHECAGEM,
  cobertura_do_plano_de_midia: 'Plano de mídia completo em cada plataforma escolhida',
  sugestoes_de_lacunas: 'Todo valor sugerido para uma lacuna tem origem em evidência',
};

const CORRECAO_NAO_CONVERGIU = 'correcao_nao_convergiu';

function rotuloDoGate(chave: string): string {
  return ROTULOS[chave] ?? nomeDoCampo(chave);
}

function tituloDaSecao(secao: string): string {
  return TITULO_DA_SECAO[secao as SecaoDoPlano] ?? nomeDoCampo(secao);
}

const MAXIMO_DO_TEXTO_VISIVEL = 120;
const SEM_ITEM_ESPECIFICO = 'Revise o plano como um todo.';

function limitado(texto: string): string {
  const seguro = textoSeguro(texto);
  return seguro.length <= MAXIMO_DO_TEXTO_VISIVEL ? seguro : `${seguro.slice(0, MAXIMO_DO_TEXTO_VISIVEL - 1)}…`;
}

export function itemLegivel(local: string): string {
  const [caminho = local, ...resto] = local.split(' (');
  const detalhe = resto.length > 0 ? resto.join(' (').replace(/\)$/, '') : null;
  const [secao = '', ...ids] = caminho.trim().split('/');
  const nome = limitado([tituloDaSecao(secao), ...ids.map(nomeDoCampo)].join(' · '));
  return detalhe === null ? nome : `${nome}: ${limitado(detalhe)}`;
}

function listaLegivel(rotulos: readonly string[]): string {
  if (rotulos.length <= 1) return rotulos.join('');
  return `${rotulos.slice(0, -1).join(', ')} e ${rotulos.at(-1)}`;
}

export function falhaDoGate(estado: EstadoParaFalhaDoGate): FalhaDoGate | null {
  if (estado.status !== 'rascunho') return null;
  const capturadas = falhasDoGate(estado.resultadoDoGate);
  if (capturadas === null) return null;

  const falhas: FalhaDoGateVisivel[] = [
    ...capturadas.checagens.map((checagem) => ({
      gate: rotuloDoGate(checagem.chave),
      itens: checagem.onde.length > 0 ? checagem.onde.map(itemLegivel) : [SEM_ITEM_ESPECIFICO],
    })),
    ...(capturadas.modelo.length === 0
      ? []
      : [{ gate: ROTULO_DA_CONFERENCIA_DE_QUALIDADE, itens: capturadas.modelo.map((p) => (p.trecho === '' ? SEM_ITEM_ESPECIFICO : itemLegivel(p.trecho))) }]),
  ];
  if (falhas.length === 0) return null;

  const nomes = listaLegivel(falhas.map((falha) => falha.gate));
  const naoConvergiu = estado.ultimaExecucao?.tipo === 'corrigir_gate' && estado.ultimaExecucao.erroCodigo === CORRECAO_NAO_CONVERGIU;
  const sobram = podeCorrigirMais(estado.correcoesFeitas);
  const temPapel = podeExecutar('editar', { tipo: 'pessoa', papel: estado.papel });

  if (!temPapel) {
    return { possivel: false, motivoLegivel: `O plano não passou na conferência: ${nomes}. Peça a um operador para corrigir.`, falhas };
  }
  if (estado.execucaoAtiva) {
    return { possivel: false, motivoLegivel: `O plano não passou na conferência: ${nomes}. Há um trabalho em andamento neste plano; aguarde ou cancele.`, falhas };
  }
  if (!sobram) {
    return {
      possivel: false,
      motivoLegivel: `A correção automática não resolveu: ${nomes}. O limite de ${MAXIMO_DE_CORRECOES_POR_VERSAO_RAIZ} correções automáticas foi atingido; ajuste o plano à mão.`,
      falhas,
    };
  }
  return {
    possivel: true,
    motivoLegivel: naoConvergiu
      ? `A correção automática não resolveu: ${nomes}. Você pode tentar mais uma vez ou ajustar à mão.`
      : `O plano não passou na conferência: ${nomes}. A correção automática pode tentar resolver.`,
    falhas,
  };
}
