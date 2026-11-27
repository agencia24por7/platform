import type { MemberRole } from '../../identity/domain/user.ts';
import { podeExecutar } from '../domain/papeis.ts';
import { cardsNaTela, type CardDoPlano, type CardNaTela } from './cardsDePlano.ts';
import { rotaDaListaDePlanos } from './rotasDaEstrategia.ts';

export type VisaoDaLista = {
  readonly cards: readonly CardNaTela[];
  readonly novoPlano: { readonly habilitado: boolean; readonly motivo: string | null; readonly href: string };
  readonly vazio: { readonly titulo: string; readonly texto: string };
  readonly formularioAberto: boolean;
  readonly emAndamento: boolean;
};

export function visaoDaLista(entrada: {
  readonly cards: readonly CardDoPlano[];
  readonly papel: MemberRole;
  readonly clienteId: string;
  readonly pediuFormulario: boolean;
}): VisaoDaLista {
  const habilitado = podeExecutar('criar', { tipo: 'pessoa', papel: entrada.papel });
  const cards = cardsNaTela(entrada.cards, entrada.clienteId, entrada.papel);
  return {
    cards,
    emAndamento: cards.some((card) => card.progresso !== null),
    novoPlano: {
      habilitado,
      motivo: habilitado ? null : 'Seu papel não permite criar plano.',
      href: rotaDaListaDePlanos(entrada.clienteId, { novo: '1' }),
    },
    vazio: {
      titulo: 'Este cliente ainda não tem plano',
      texto: habilitado ? 'Peça o primeiro plano: você informa a intenção e o agente redige.' : 'Quem opera ou administra pode pedir o primeiro plano.',
    },
    formularioAberto: entrada.pediuFormulario && habilitado,
  };
}
