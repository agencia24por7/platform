import type { EtapaDaExecucao, PlanoDoCliente } from '../application/portas.ts';
import { ROTULO_DO_STATUS, type StatusDaVersao } from '../domain/status.ts';
import { ROTULO_DO_TIPO_DE_PLANO, ehTipoDePlano } from '../domain/tipoDePlano.ts';
import { dataEHoraBr } from './formatosDoPlano.ts';
import { rotaDoPlano } from './rotasDaEstrategia.ts';
import { ROTULO_DA_PLATAFORMA_DO_PLANO } from './rotulosDoPlano.ts';

export type EstadoDoCard = StatusDaVersao | 'gerando' | 'falhou' | 'cancelada' | 'sem_versao';

export type ProgressoDoCard = { readonly percentual: number; readonly etapa: string };

export type CardDoPlano = {
  readonly planoId: string;
  readonly titulo: string;
  readonly tipo: string;
  readonly tipoRotulo: string;
  readonly plataformas: readonly { readonly plataforma: string; readonly rotulo: string }[];
  readonly estado: EstadoDoCard;
  readonly rotulo: string;
  readonly progresso: ProgressoDoCard | null;
  readonly execucaoAtivaId: string | null;
  readonly ultimaExecucaoFalhou: boolean;
  readonly criadoEm: Date;
  readonly atualizadoEm: Date;
};

export const TAMANHO_MAXIMO_DO_TITULO = 90;

const PROGRESSO_DA_ETAPA: Readonly<Record<EtapaDaExecucao, ProgressoDoCard>> = {
  ler_brain: { percentual: 10, etapa: 'Lendo o contexto do cliente' },
  redigir: { percentual: 35, etapa: 'Redigindo o plano' },
  comite: { percentual: 65, etapa: 'Revisando o plano' },
  ajustar: { percentual: 80, etapa: 'Ajustando o plano' },
  gates: { percentual: 92, etapa: 'Conferindo o plano' },
  fim: { percentual: 100, etapa: 'Concluído' },
};

const ROTULO_DO_ESTADO_SEM_VERSAO: Readonly<Record<'gerando' | 'falhou' | 'cancelada' | 'sem_versao', string>> = {
  gerando: 'Em geração',
  falhou: 'Falhou',
  cancelada: 'Cancelado',
  sem_versao: 'Sem versão',
};

export function tituloDoPlano(objetivo: string | null, tipo: string): string {
  const limpo = (objetivo ?? '').replace(/\s+/g, ' ').trim();
  if (limpo === '') return `Plano de ${ehTipoDePlano(tipo) ? ROTULO_DO_TIPO_DE_PLANO[tipo] : tipo}`;
  return limpo.length <= TAMANHO_MAXIMO_DO_TITULO ? limpo : `${limpo.slice(0, TAMANHO_MAXIMO_DO_TITULO - 1).trimEnd()}…`;
}

export function cardDoPlano(estado: PlanoDoCliente): CardDoPlano {
  const { plano, ultimaExecucao } = estado;
  const ativa = ultimaExecucao !== null && (ultimaExecucao.status === 'pendente' || ultimaExecucao.status === 'rodando') ? ultimaExecucao : null;
  const exibida = estado.aberta ?? estado.vigente ?? estado.maisRecente;
  let cardEstado: EstadoDoCard;
  if (ativa) cardEstado = 'gerando';
  else if (exibida) cardEstado = exibida.status;
  else if (ultimaExecucao?.status === 'falhou' || ultimaExecucao?.status === 'cancelada') cardEstado = ultimaExecucao.status;
  else cardEstado = 'sem_versao';
  const rotulo = cardEstado in ROTULO_DO_STATUS ? ROTULO_DO_STATUS[cardEstado as StatusDaVersao] : ROTULO_DO_ESTADO_SEM_VERSAO[cardEstado as keyof typeof ROTULO_DO_ESTADO_SEM_VERSAO];
  return {
    planoId: plano.id,
    titulo: tituloDoPlano(estado.objetivo, plano.tipo),
    tipo: plano.tipo,
    tipoRotulo: ehTipoDePlano(plano.tipo) ? ROTULO_DO_TIPO_DE_PLANO[plano.tipo] : plano.tipo,
    plataformas: (plano.plataformas ?? []).map((plataforma) => ({ plataforma, rotulo: ROTULO_DA_PLATAFORMA_DO_PLANO[plataforma] ?? plataforma })),
    estado: cardEstado,
    rotulo,
    progresso: ativa ? PROGRESSO_DA_ETAPA[ativa.etapa] : null,
    execucaoAtivaId: ativa?.id ?? null,
    ultimaExecucaoFalhou: ultimaExecucao?.status === 'falhou',
    criadoEm: plano.criadoEm,
    atualizadoEm: estado.atualizadoEm,
  };
}

export type CardNaTela = {
  readonly planoId: string;
  readonly href: string;
  readonly titulo: string;
  readonly tipoRotulo: string;
  readonly plataformas: readonly string[];
  readonly rotulo: string;
  readonly icone: 'ok' | 'atencao' | 'erro' | 'nao' | 'vazio';
  readonly classe: string;
  readonly atualizadoEm: Date;
  readonly atualizadoEmTexto: string;
  readonly progresso: ProgressoDoCard | null;
};

const APARENCIA_DO_CARD: Readonly<Record<EstadoDoCard, { readonly icone: CardNaTela['icone']; readonly classe: string }>> = {
  rascunho: { icone: 'vazio', classe: '' },
  proposto: { icone: 'atencao', classe: 'pill--warn' },
  vigente: { icone: 'ok', classe: 'pill--ok' },
  superado: { icone: 'nao', classe: '' },
  revogado: { icone: 'nao', classe: '' },
  rejeitado: { icone: 'erro', classe: 'pill--danger' },
  cancelado: { icone: 'nao', classe: '' },
  gerando: { icone: 'atencao', classe: 'pill--warn' },
  falhou: { icone: 'erro', classe: 'pill--danger' },
  cancelada: { icone: 'nao', classe: '' },
  sem_versao: { icone: 'vazio', classe: '' },
};

export function cardsNaTela(cards: readonly CardDoPlano[], clienteId: string): CardNaTela[] {
  return [...cards]
    .sort((a, b) => b.atualizadoEm.getTime() - a.atualizadoEm.getTime())
    .map((card) => ({
      planoId: card.planoId,
      href: rotaDoPlano(clienteId, card.planoId),
      titulo: card.titulo,
      tipoRotulo: card.tipoRotulo,
      plataformas: card.plataformas.map((p) => p.rotulo),
      rotulo: card.rotulo,
      ...APARENCIA_DO_CARD[card.estado],
      atualizadoEm: card.atualizadoEm,
      atualizadoEmTexto: dataEHoraBr(card.atualizadoEm),
      progresso: card.progresso,
    }));
}
