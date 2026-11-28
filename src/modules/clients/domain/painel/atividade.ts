import { ROTULO_DA_PLATAFORMA, type Platform } from '../../../connections/domain/connection.ts';
import { ROTULO_EPISTEMICO, ROTULO_FONTE, type Campo, type CampoSimples, type Epistemico, type Fonte } from '../contexto/catalogo.ts';
import { textoDoValor } from '../contexto/leitura.ts';
import type { TomDoIndicador } from './indicadores.ts';
import { tempoRelativo } from './resumo.ts';

export type ConviteDaAtividade = {
  readonly id: string;
  readonly token: string;
  readonly status: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly items: readonly { readonly id: string; readonly platform: Platform; readonly status: string }[];
};

export type LinkDaAtividade = {
  readonly id: string;
  readonly estado: string;
  readonly secoes: readonly string[];
  readonly expiraEm: Date;
  readonly criadoEm: Date;
  readonly ultimoUsoEm: Date | null;
  readonly concluidoEm: Date | null;
  readonly conviteDeIntegracaoId: string | null;
};

export type PedidoDeParceiroDaAtividade = {
  readonly id: string;
  readonly status: string;
  readonly targetExternalId: string;
  readonly outcome: string | null;
  readonly createdAt: Date;
};

export type EstadoNaAtividade = { readonly rotulo: string; readonly tom: TomDoIndicador };

export type ConvitePendente = {
  readonly id: string;
  readonly token: string;
  readonly plataformas: readonly { readonly id: string; readonly platform: Platform; readonly rotulo: string; readonly concluida: boolean; readonly estado: string }[];
  readonly vence: string;
};

export type LinkAtivo = {
  readonly id: string;
  readonly titulo: string;
  readonly secoes: string;
  readonly vence: string;
  readonly uso: string;
  readonly enviado: boolean;
  readonly comConvite: boolean;
};

export type ItemDoHistorico = {
  readonly chave: string;
  readonly titulo: string;
  readonly detalhe: string | null;
  readonly estado: EstadoNaAtividade;
  readonly quando: string;
};

export type VisaoDosPedidos = {
  readonly convitesPendentes: readonly ConvitePendente[];
  readonly linksAtivos: readonly LinkAtivo[];
  readonly historico: readonly ItemDoHistorico[];
  readonly totalPendente: number;
  readonly descricao: string;
};

const ROTULO_DO_CONVITE: Readonly<Record<string, string>> = { pending: 'Pendente', completed: 'Concluído', expired: 'Expirado', revoked: 'Revogado' };
const TOM_DO_CONVITE: Readonly<Record<string, TomDoIndicador>> = { completed: 'ok', expired: 'neutro', revoked: 'neutro' };
const ROTULO_DO_LINK: Readonly<Record<string, string>> = { ativo: 'Ativo', expirado: 'Expirado', revogado: 'Revogado' };
const PEDIDO_DE_PARCEIRO: Readonly<Record<string, EstadoNaAtividade>> = { done: { rotulo: 'Concluído', tom: 'ok' }, failed: { rotulo: 'Falhou', tom: 'critico' } };
const PEDIDO_EM_ANDAMENTO: EstadoNaAtividade = { rotulo: 'Em andamento', tom: 'atencao' };

function secoesPorExtenso(total: number): string {
  return `${total} ${total === 1 ? 'seção' : 'seções'}`;
}

function plataformasDe(convite: ConviteDaAtividade): string {
  return convite.items.map((item) => ROTULO_DA_PLATAFORMA[item.platform]).join(', ');
}

export function conviteEstaPendente(convite: ConviteDaAtividade, agora: Date): boolean {
  return convite.status === 'pending' && convite.expiresAt > agora;
}

export function visaoDosPedidos(
  entrada: {
    readonly convites: readonly ConviteDaAtividade[];
    readonly links: readonly LinkDaAtividade[];
    readonly pedidosDeParceiro: readonly PedidoDeParceiroDaAtividade[];
    readonly nomeDaSecao: (chave: string) => string;
  },
  agora: Date,
): VisaoDosPedidos {
  const pendentes = entrada.convites.filter((convite) => conviteEstaPendente(convite, agora));
  const encerrados = entrada.convites.filter((convite) => !conviteEstaPendente(convite, agora));
  const linksAtivos = entrada.links.filter((link) => link.estado === 'ativo');
  const linksAntigos = entrada.links.filter((link) => link.estado !== 'ativo');

  const historico: { readonly item: ItemDoHistorico; readonly em: number }[] = [
    ...encerrados.map((convite) => ({
      em: convite.createdAt.getTime(),
      item: {
        chave: `convite-${convite.id}`,
        titulo: plataformasDe(convite),
        detalhe: null,
        estado: convite.status === 'pending' ? { rotulo: 'Expirado', tom: 'neutro' as const } : { rotulo: ROTULO_DO_CONVITE[convite.status] ?? convite.status, tom: TOM_DO_CONVITE[convite.status] ?? 'neutro' },
        quando: `criado ${tempoRelativo(convite.createdAt, agora)}`,
      },
    })),
    ...linksAntigos.map((link) => ({
      em: link.criadoEm.getTime(),
      item: {
        chave: `link-${link.id}`,
        titulo: `Contexto · ${secoesPorExtenso(link.secoes.length)}`,
        detalhe: null,
        estado: link.concluidoEm ? { rotulo: 'Enviado', tom: 'ok' as const } : { rotulo: ROTULO_DO_LINK[link.estado] ?? link.estado, tom: 'neutro' as const },
        quando: `criado ${tempoRelativo(link.criadoEm, agora)}`,
      },
    })),
    ...entrada.pedidosDeParceiro.map((pedido) => ({
      em: pedido.createdAt.getTime(),
      item: {
        chave: `parceiro-${pedido.id}`,
        titulo: 'Pedido de parceiro no Meta',
        detalhe: pedido.targetExternalId,
        estado: PEDIDO_DE_PARCEIRO[pedido.status] ?? PEDIDO_EM_ANDAMENTO,
        quando: pedido.outcome ?? `criado ${tempoRelativo(pedido.createdAt, agora)}`,
      },
    })),
  ];

  return {
    convitesPendentes: pendentes.map((convite) => ({
      id: convite.id,
      token: convite.token,
      plataformas: convite.items.map((item) => ({
        id: item.id,
        platform: item.platform,
        rotulo: ROTULO_DA_PLATAFORMA[item.platform],
        concluida: item.status === 'completed',
        estado: ROTULO_DO_CONVITE[item.status] ?? item.status,
      })),
      vence: `vence ${tempoRelativo(convite.expiresAt, agora)}`,
    })),
    linksAtivos: linksAtivos.map((link) => ({
      id: link.id,
      titulo: `Contexto · ${secoesPorExtenso(link.secoes.length)}`,
      secoes: link.secoes.map(entrada.nomeDaSecao).join(', '),
      vence: `vence ${tempoRelativo(link.expiraEm, agora)}`,
      uso: link.ultimoUsoEm ? `aberto ${tempoRelativo(link.ultimoUsoEm, agora)}` : 'ainda não aberto',
      enviado: link.concluidoEm !== null,
      comConvite: link.conviteDeIntegracaoId !== null,
    })),
    historico: historico.sort((a, b) => b.em - a.em).map(({ item }) => item),
    totalPendente: pendentes.length + linksAtivos.length,
    descricao: pendentes.length + linksAtivos.length > 0 ? `${pendentes.length + linksAtivos.length} esperando resposta.` : 'Nada esperando resposta.',
  };
}

export function rotuloDoConvitePendente(convite: ConviteDaAtividade, agora: Date): string {
  return `${plataformasDe(convite)} · vence ${tempoRelativo(convite.expiresAt, agora)}`;
}

export type RevisaoDaAtividade = {
  readonly id: string;
  readonly secao: string;
  readonly chave: string;
  readonly operacao: 'criar' | 'alterar' | 'status' | 'remover';
  readonly viaLink: boolean;
  readonly em: Date;
  readonly diferencas: readonly { readonly chave: string; readonly antes: unknown; readonly depois: unknown }[];
};

export type SecaoParaRotulo = { readonly key: string; readonly letra: string; readonly titulo: string; readonly campos: readonly Campo[] };

export type RevisaoNaTela = {
  readonly id: string;
  readonly secao: string;
  readonly campo: string;
  readonly origem: string;
  readonly operacao: string;
  readonly quando: string;
  readonly emIso: string;
  readonly diferencas: readonly { readonly chave: string; readonly antes: string; readonly depois: string }[];
  readonly diferencasOcultas: number;
};

const ROTULO_DA_OPERACAO: Record<RevisaoDaAtividade['operacao'], string> = { criar: 'Preenchido', alterar: 'Alterado', status: 'Marcação alterada', remover: 'Removido' };
const LIMITE_DO_VALOR = 80;
const LIMITE_DE_DIFERENCAS = 6;

function cortar(texto: string): string {
  return texto.length > LIMITE_DO_VALOR ? `${texto.slice(0, LIMITE_DO_VALOR - 1)}…` : texto;
}

function valorLegivel(campo: CampoSimples | null, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '∅';
  const legivel = campo ? textoDoValor(campo, valor) : null;
  return cortar(legivel ?? (typeof valor === 'string' ? valor : JSON.stringify(valor)));
}

type Metadado = { readonly rotulo: string; readonly texto: (valor: unknown) => string };

const ROTULO_DA_REVISAO: Readonly<Record<string, string>> = { confirmado: 'Confirmado', sugerido: 'Sugerido' };

const METADADOS: Readonly<Record<string, Metadado>> = {
  epistemic: { rotulo: 'Natureza', texto: (valor) => ROTULO_EPISTEMICO[valor as Epistemico] ?? String(valor) },
  review: { rotulo: 'Revisão', texto: (valor) => ROTULO_DA_REVISAO[String(valor)] ?? String(valor) },
  source: { rotulo: 'Fonte', texto: (valor) => ROTULO_FONTE[valor as Fonte] ?? String(valor) },
  shareable: { rotulo: 'Visível ao cliente', texto: (valor) => (valor === true ? 'Sim' : valor === false ? 'Não' : String(valor)) },
};

function ausente(valor: unknown): boolean {
  return valor === null || valor === undefined || valor === '';
}

function campoDaDiferenca(campo: Campo | undefined, chave: string): { readonly rotulo: string; readonly campo: CampoSimples | null } {
  if (!campo) return { rotulo: chave, campo: null };
  if (campo.tipo === 'lista') {
    const sub = campo.item.find((item) => item.key === chave);
    return sub ? { rotulo: sub.rotulo, campo: sub } : { rotulo: chave, campo: null };
  }
  return chave === 'valor' ? { rotulo: 'Valor', campo } : { rotulo: chave, campo: null };
}

type DiferencaNaTela = RevisaoNaTela['diferencas'][number];

function diferencaNaTela(definicao: Campo | undefined, d: RevisaoDaAtividade['diferencas'][number]): DiferencaNaTela | null {
  const metadado = METADADOS[d.chave];
  if (metadado) {
    if (ausente(d.antes)) return null;
    return { chave: metadado.rotulo, antes: metadado.texto(d.antes), depois: ausente(d.depois) ? '∅' : metadado.texto(d.depois) };
  }
  const alvo = campoDaDiferenca(definicao, d.chave);
  return { chave: alvo.rotulo, antes: valorLegivel(alvo.campo, d.antes), depois: valorLegivel(alvo.campo, d.depois) };
}

export function visaoDasRevisoes(revisoes: readonly RevisaoDaAtividade[], secoes: readonly SecaoParaRotulo[], agora: Date): readonly RevisaoNaTela[] {
  const porSecao = new Map(secoes.map((secao) => [secao.key, secao]));
  return revisoes.map((revisao) => {
    const secao = porSecao.get(revisao.secao);
    const definicao = secao?.campos.find((c) => c.key === revisao.chave);
    const visiveis = [...revisao.diferencas]
      .sort((a, b) => Number(METADADOS[a.chave] !== undefined) - Number(METADADOS[b.chave] !== undefined))
      .map((d) => diferencaNaTela(definicao, d))
      .filter((d): d is DiferencaNaTela => d !== null);
    return {
      id: revisao.id,
      secao: secao ? `${secao.letra} · ${secao.titulo}` : revisao.secao,
      campo: definicao?.rotulo ?? revisao.chave,
      origem: revisao.viaLink ? 'cliente' : 'equipe',
      operacao: ROTULO_DA_OPERACAO[revisao.operacao],
      quando: tempoRelativo(revisao.em, agora),
      emIso: revisao.em.toISOString(),
      diferencas: visiveis.slice(0, LIMITE_DE_DIFERENCAS),
      diferencasOcultas: Math.max(0, visiveis.length - LIMITE_DE_DIFERENCAS),
    };
  });
}
