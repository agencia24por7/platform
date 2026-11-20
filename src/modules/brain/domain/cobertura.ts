import type { Cobertura } from './entrada.ts';
import type { JanelaColetada, MedidaDeCobertura } from './inventario.ts';
import { diasEntre, horasDesde, somarDias } from './tempo.ts';

export const VALIDADE_DA_MEDIDA_HORAS = 36;
const MAXIMO_DE_LACUNAS = 20;

export function unirJanelas(janelas: readonly JanelaColetada[]): readonly JanelaColetada[] {
  const ordenadas = janelas.filter((j) => j.de <= j.ate).map((j) => ({ ...j })).sort((a, b) => a.de.localeCompare(b.de));
  const unidas: { de: string; ate: string }[] = [];
  for (const janela of ordenadas) {
    const ultima = unidas[unidas.length - 1];
    if (ultima && janela.de <= somarDias(ultima.ate, 1)) {
      if (janela.ate > ultima.ate) ultima.ate = janela.ate;
      continue;
    }
    unidas.push({ de: janela.de, ate: janela.ate });
  }
  return unidas;
}

export type Lacuna = { readonly de: string; readonly ate: string; readonly dias: number };

export function lacunasEntre(janelas: readonly JanelaColetada[], de: string, ate: string): readonly Lacuna[] {
  if (de > ate) return [];
  const lacunas: Lacuna[] = [];
  let cursor = de;
  for (const janela of unirJanelas(janelas)) {
    if (janela.ate < cursor) continue;
    if (janela.de > ate) break;
    if (janela.de > cursor) {
      const fim = somarDias(janela.de, -1) < ate ? somarDias(janela.de, -1) : ate;
      lacunas.push({ de: cursor, ate: fim, dias: diasEntre(cursor, fim) });
    }
    cursor = somarDias(janela.ate, 1);
    if (cursor > ate) break;
  }
  if (cursor <= ate) lacunas.push({ de: cursor, ate, dias: diasEntre(cursor, ate) });
  return lacunas;
}

function diasCobertos(janelas: readonly JanelaColetada[], ate: string): number {
  return unirJanelas(janelas).reduce((total, janela) => {
    if (janela.de > ate) return total;
    const fim = janela.ate > ate ? ate : janela.ate;
    return total + diasEntre(janela.de, fim);
  }, 0);
}

export function coberturaPorColetas(janelas: readonly JanelaColetada[], esperadoAte: string): Cobertura {
  const unidas = unirJanelas(janelas);
  if (unidas.length === 0) {
    return {
      desde: null, ate: null, linhas: null, diasComDado: 0, diasEsperados: null,
      lacunas: [], diasFaltando: null, fonteDaMedida: 'coletas', medidoEm: null,
    };
  }
  const desde = unidas[0]!.de;
  const ate = unidas[unidas.length - 1]!.ate;
  const limite = ate > esperadoAte ? ate : esperadoAte;
  const lacunas = lacunasEntre(unidas, desde, limite);
  return {
    desde,
    ate,
    linhas: null,
    diasComDado: diasCobertos(unidas, limite),
    diasEsperados: diasEntre(desde, limite),
    lacunas: lacunas.slice(-MAXIMO_DE_LACUNAS),
    diasFaltando: lacunas.reduce((total, lacuna) => total + lacuna.dias, 0),
    fonteDaMedida: 'coletas',
    medidoEm: null,
  };
}

export function coberturaPorMedida(medida: MedidaDeCobertura, esperadoAte: string | null): Cobertura {
  const limite = medida.ate && esperadoAte && esperadoAte > medida.ate ? esperadoAte : medida.ate;
  const diasEsperados = medida.desde && limite ? diasEntre(medida.desde, limite) : null;
  const diasFaltando = diasEsperados !== null && medida.diasComDado !== null ? Math.max(diasEsperados - medida.diasComDado, 0) : null;
  return {
    desde: medida.desde,
    ate: medida.ate,
    linhas: medida.linhas,
    diasComDado: medida.diasComDado,
    diasEsperados,
    lacunas: [],
    diasFaltando,
    fonteDaMedida: 'gov_cobertura_cliente',
    medidoEm: medida.medidoEm.toISOString(),
  };
}

export function medidaVigente(medida: MedidaDeCobertura | undefined, agora: Date): MedidaDeCobertura | null {
  if (!medida) return null;
  return horasDesde(medida.medidoEm, agora) <= VALIDADE_DA_MEDIDA_HORAS ? medida : null;
}

export function escolherCobertura(
  medida: MedidaDeCobertura | undefined,
  janelas: readonly JanelaColetada[],
  esperadoAte: string,
  agora: Date,
): Cobertura {
  const vigente = medidaVigente(medida, agora);
  return vigente ? coberturaPorMedida(vigente, esperadoAte) : coberturaPorColetas(janelas, esperadoAte);
}
