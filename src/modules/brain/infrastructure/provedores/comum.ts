import { coberturaPorColetas } from '../../domain/cobertura.ts';
import type { Sensibilidade } from '../../domain/entrada.ts';
import { calcularFrescor, esperadoAte } from '../../domain/frescor.ts';
import type { FonteDoInventario, InventarioDoCliente, JanelaColetada, ResumoDeColetas } from '../../domain/inventario.ts';
import { conectorDe } from '../../dados/registro.ts';

export const RETENCAO_DOS_DADOS = 'Enquanto o cliente existir; a exclusão lógica esconde e o expurgo apaga pelo período de posse (ADR 0022 e 0023).';
export const RETENCAO_DO_CONTEXTO = 'Enquanto o cliente existir; o expurgo do cliente apaga o contexto, os arquivos e este catálogo.';

export const SENSIBILIDADE_DE_NEGOCIO: Sensibilidade = {
  nivel: 'negocio',
  piiPossivel: false,
  usoPorAgente: 'permitido',
  retencao: RETENCAO_DOS_DADOS,
};

export function atrasoDaPlataforma(plataforma: string): number {
  return conectorDe(plataforma)?.atrasoDias ?? 1;
}

export function resumosPorFonte(inventario: InventarioDoCliente): ReadonlyMap<string, ResumoDeColetas> {
  return new Map(inventario.coletas.map((resumo) => [resumo.fonteId, resumo]));
}

export function janelasDasFontes(fontes: readonly FonteDoInventario[], resumos: ReadonlyMap<string, ResumoDeColetas>): readonly JanelaColetada[] {
  return fontes.flatMap((fonte) => resumos.get(fonte.id)?.janelasOk ?? []);
}

export function ultimaColetaOk(fontes: readonly FonteDoInventario[], resumos: ReadonlyMap<string, ResumoDeColetas>): Date | null {
  const momentos = fontes.map((f) => resumos.get(f.id)?.ultimaColetaOkEm?.getTime() ?? 0).filter((t) => t > 0);
  return momentos.length > 0 ? new Date(Math.max(...momentos)) : null;
}

export function situacaoDasFontes(fontes: readonly FonteDoInventario[], inventario: InventarioDoCliente, agora: Date) {
  const resumos = resumosPorFonte(inventario);
  const atraso = Math.min(...fontes.map((f) => atrasoDaPlataforma(f.platform)), 30);
  const esperado = esperadoAte(atraso, agora);
  const janelas = janelasDasFontes(fontes, resumos);
  const cobertura = coberturaPorColetas(janelas, esperado);
  const frescor = calcularFrescor({ dadoAte: cobertura.ate, ultimaAtualizacao: ultimaColetaOk(fontes, resumos), atrasoDias: atraso, agora });
  return { cobertura, frescor, esperado, janelas, atraso };
}
