import {
  avaliarAcao,
  compararValores,
  estaVigente,
  type AcaoProposta,
  type ConjuntoVigente,
  type Decisao,
  type DefinicaoDeLimite,
  type Periodo,
} from '@/modules/clients/domain/regras/index';
import { MEDIDAS, type Medida } from '@/modules/clients/domain/regras/medida';
import type { Valor } from '@/modules/clients/domain/regras/valor';
import type { RegrasService } from '@/modules/clients/application/regrasService';
import { err, ok, type Result } from '@/shared/result/result';
import type { AvaliadorDeLimites, AvaliarLimite, ErroDeLimites, Relogio } from '@/modules/strategy/application/portas';
import type { Plano, VereditoDoLimite } from '@/modules/strategy/domain/index';

export type DependenciasDoAvaliadorDeLimites = {
  readonly regras: Pick<RegrasService, 'conjuntoParaAgente'>;
  readonly relogio?: Relogio;
};

export type AvaliacaoComMotivo = { readonly veredito: VereditoDoLimite; readonly motivo: string };

const DIAS_POR_MES_DO_PLANO = 30;
const UM_DIA_MS = 24 * 60 * 60 * 1000;

export function diasDoHorizonte(inicio: string, fim: string): number {
  const dias = Math.round((Date.parse(`${fim}T00:00:00.000Z`) - Date.parse(`${inicio}T00:00:00.000Z`)) / UM_DIA_MS) + 1;
  return Math.max(1, dias);
}

export function mesesDoHorizonte(inicio: string, fim: string): number {
  return Math.max(1, Math.ceil(diasDoHorizonte(inicio, fim) / DIAS_POR_MES_DO_PLANO));
}

export function dividirParaCima(centavos: bigint, divisor: number): bigint {
  const d = BigInt(divisor);
  return (centavos + d - 1n) / d;
}

type Horizonte = { readonly dias: number; readonly meses: number };

function valorNoPeriodo(medida: Medida, valor: Valor, periodo: Periodo, horizonte: Horizonte): Valor {
  if (medida !== 'gasto' || valor.unidade !== 'brl_centavos' || periodo === 'total') return valor;
  const divisor = periodo === 'mes' ? horizonte.meses : horizonte.dias;
  return { ...valor, centavos: dividirParaCima(BigInt(valor.centavos), divisor).toString() };
}

export function medidasComLimiteVigente(
  decisoes: readonly Decisao[],
  definicoes: readonly DefinicaoDeLimite[],
  agora: Date,
): Medida[] {
  const indice = new Map(definicoes.map((d) => [`${d.key}@${d.version}`, d]));
  const medidas = new Set<Medida>();
  for (const limite of decisoes) {
    if (limite.natureza !== 'limite' || limite.valor === null || !estaVigente(limite, agora)) continue;
    const definicao = indice.get(`${limite.definicaoChave}@${limite.definicaoVersao}`);
    if (definicao === undefined) for (const medida of MEDIDAS) medidas.add(medida);
    else medidas.add(definicao.medida);
  }
  return [...medidas].sort();
}

export function avaliarContraLimites(
  medida: Medida,
  valor: Valor,
  decisoes: readonly Decisao[],
  definicoes: readonly DefinicaoDeLimite[],
  vigentes: ConjuntoVigente,
  horizonte: Horizonte,
  agora: Date,
): AvaliacaoComMotivo {
  const indice = new Map(definicoes.map((d) => [`${d.key}@${d.version}`, d]));
  const limites = decisoes.filter((d) => d.natureza === 'limite' && d.valor !== null && estaVigente(d, agora));
  const combinacoes = new Map<string, { periodo: Periodo; escopo: string }>();

  for (const limite of limites) {
    const definicao = indice.get(`${limite.definicaoChave}@${limite.definicaoVersao}`);
    if (definicao === undefined) {
      return { veredito: 'bloqueia', motivo: `limite vigente sem definição (${limite.chave ?? 'sem chave'}): não dá para comparar` };
    }
    if (definicao.medida !== medida) continue;
    const proposto = valorNoPeriodo(medida, valor, definicao.periodo, horizonte);
    if (limite.valor === null || !compararValores(proposto, limite.valor).ok) {
      return { veredito: 'bloqueia', motivo: `valor incomparável com o limite vigente ${limite.chave ?? definicao.key} (unidade diferente)` };
    }
    combinacoes.set(`${definicao.periodo}|${limite.escopo}`, { periodo: definicao.periodo, escopo: limite.escopo });
  }

  if (combinacoes.size === 0) return { veredito: 'sem_regra', motivo: 'não existe limite vigente para a medida' };

  for (const { periodo, escopo } of combinacoes.values()) {
    const acao: AcaoProposta = { medida, valorProposto: valorNoPeriodo(medida, valor, periodo, horizonte), periodo, escopo, agora };
    const resultado = avaliarAcao(definicoes, vigentes, acao);
    if (resultado.resultado === 'bloqueada') {
      const motivo = resultado.motivo === 'definicao_ausente' ? 'limite vigente sem definição' : `viola o limite vigente (${periodo}, ${escopo})`;
      return { veredito: 'bloqueia', motivo };
    }
  }
  return { veredito: 'ok', motivo: 'dentro dos limites vigentes' };
}

export function criarAvaliadorDeLimites(dependencias: DependenciasDoAvaliadorDeLimites): AvaliadorDeLimites {
  const relogio = dependencias.relogio ?? { agora: () => new Date() };
  return {
    async avaliador(organizacaoId, clienteId, plano: Plano): Promise<Result<AvaliarLimite, ErroDeLimites>> {
      let conjunto: Awaited<ReturnType<RegrasService['conjuntoParaAgente']>>;
      try {
        conjunto = await dependencias.regras.conjuntoParaAgente({ organizationId: organizacaoId, clientId: clienteId });
      } catch {
        return err({ codigo: 'limites_indisponiveis', mensagem: 'As regras vigentes do cliente não puderam ser lidas.' });
      }
      if (!conjunto.ok) return err({ codigo: 'limites_indisponiveis', mensagem: 'As regras vigentes do cliente não puderam ser lidas.' });

      const vigentes: ConjuntoVigente = { decisoes: conjunto.value.decisoes, conflitos: conjunto.value.conflitos, porChaveEEscopo: new Map() };
      const horizonte: Horizonte = {
        dias: diasDoHorizonte(plano.intencao.horizonte.inicio, plano.intencao.horizonte.fim),
        meses: mesesDoHorizonte(plano.intencao.horizonte.inicio, plano.intencao.horizonte.fim),
      };
      const agora = relogio.agora();
      const avaliar = (medida: Medida, valor: Valor) =>
        avaliarContraLimites(medida, valor, conjunto.value.decisoes, conjunto.value.definicoes, vigentes, horizonte, agora).veredito;
      const avaliarLimite: AvaliarLimite = Object.assign(avaliar, {
        medidasComLimite: medidasComLimiteVigente(conjunto.value.decisoes, conjunto.value.definicoes, agora),
      });
      return ok(avaliarLimite);
    },
  };
}
