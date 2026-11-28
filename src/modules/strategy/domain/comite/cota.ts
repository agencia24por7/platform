import { err, ok, type Result } from '../../../../shared/result/result.ts';
import type { Comite } from './comites.ts';
import { MAXIMO_DE_PONTOS_NO_JUIZ } from './juiz.ts';
import { sintetizarParecerDoComite, type ErroDaMesa, type ParecerDeMembro, type RodadaDaMesa, type SinteseDoComite } from './mesa.ts';
import { MAXIMO_DE_PONTOS_POR_PARECER, VEREDITOS, type Veredito } from './parecer.ts';

export type PedidoDeCota = {
  readonly chave: string;
  readonly obrigaAjuste: boolean;
  readonly veredito: Veredito;
  readonly pontosPedidos: number;
};

const severidadeDe = (veredito: Veredito) => VEREDITOS.indexOf(veredito);

const vaiAoJuiz = (pedido: PedidoDeCota) => !(pedido.obrigaAjuste && pedido.veredito === 'reprova');

export function repartirCotaDoJuiz(pedidos: readonly PedidoDeCota[], teto: number = MAXIMO_DE_PONTOS_NO_JUIZ): ReadonlyMap<string, number> {
  const cotas = new Map<string, number>();
  const noJuiz = pedidos.map((pedido, ordem) => ({ pedido, ordem })).filter(({ pedido }) => vaiAoJuiz(pedido));
  for (const pedido of pedidos) if (!vaiAoJuiz(pedido)) cotas.set(pedido.chave, MAXIMO_DE_PONTOS_POR_PARECER);
  if (noJuiz.length === 0) return cotas;

  const base = Math.floor(teto / noJuiz.length);
  let sobra = teto;
  for (const { pedido } of noJuiz) {
    const cota = Math.min(base, pedido.pontosPedidos);
    cotas.set(pedido.chave, cota);
    sobra -= cota;
  }
  const porPrioridade = [...noJuiz].sort(
    (a, b) => severidadeDe(b.pedido.veredito) - severidadeDe(a.pedido.veredito) || b.pedido.pontosPedidos - a.pedido.pontosPedidos || a.ordem - b.ordem,
  );
  for (const { pedido } of porPrioridade) {
    if (sobra <= 0) break;
    const falta = pedido.pontosPedidos - (cotas.get(pedido.chave) ?? 0);
    const extra = Math.min(falta, sobra);
    if (extra <= 0) continue;
    cotas.set(pedido.chave, (cotas.get(pedido.chave) ?? 0) + extra);
    sobra -= extra;
  }
  return cotas;
}

export type EntradaDaSintese = {
  readonly comite: Comite;
  readonly pareceres: readonly ParecerDeMembro[];
  readonly mesa2: RodadaDaMesa;
};

export function sintetizarComitesComCota(entradas: readonly EntradaDaSintese[], teto: number = MAXIMO_DE_PONTOS_NO_JUIZ): Result<ReadonlyMap<string, SinteseDoComite>, ErroDaMesa> {
  const cheias = new Map<string, SinteseDoComite>();
  for (const { comite, pareceres, mesa2 } of entradas) {
    const sintese = sintetizarParecerDoComite(comite, pareceres, mesa2);
    if (!sintese.ok) return err(sintese.error);
    cheias.set(comite.chave, sintese.value);
  }
  const cotas = repartirCotaDoJuiz(
    entradas.map(({ comite }) => {
      const sintese = cheias.get(comite.chave)!;
      return { chave: comite.chave, obrigaAjuste: comite.obrigaAjuste, veredito: sintese.parecer.veredito, pontosPedidos: sintese.pontosPedidos };
    }),
    teto,
  );
  const finais = new Map<string, SinteseDoComite>();
  for (const { comite, pareceres, mesa2 } of entradas) {
    const cota = cotas.get(comite.chave) ?? MAXIMO_DE_PONTOS_POR_PARECER;
    const cheia = cheias.get(comite.chave)!;
    if (cheia.parecer.pontos.length <= cota) {
      finais.set(comite.chave, cheia);
      continue;
    }
    const cortada = sintetizarParecerDoComite(comite, pareceres, mesa2, cota);
    if (!cortada.ok) return err(cortada.error);
    finais.set(comite.chave, cortada.value);
  }
  return ok(finais);
}
