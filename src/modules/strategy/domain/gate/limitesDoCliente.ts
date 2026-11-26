import type { Medida } from '../../../clients/domain/regras/medida.ts';
import type { Valor } from '../../../clients/domain/regras/valor.ts';
import { centavosDe, comoValor } from '../dinheiro.ts';
import type { Meta, Plano } from '../plano.ts';
import { aprovar, montarResultado, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_LIMITES_DO_CLIENTE = 'limites_do_cliente';
export const MOTIVO_DE_LIMITE_NAO_DECLARADO = 'limite de gasto ausente e não declarado em lacunas';

function previstoComoValor(meta: Meta): Valor | null {
  return meta.previsto.unidade === 'contagem' ? null : meta.previsto;
}

function declaracoesDeNaoAplicavel(plano: Plano): Map<Medida, string> {
  const declaradas = new Map<Medida, string>();
  for (const declaracao of plano.riscos_e_regras.limites_nao_aplicaveis) {
    if ((declaracao.medida as Medida) === 'gasto') continue;
    declaradas.set(declaracao.medida, declaracao.motivo);
  }
  return declaradas;
}

function limiteDeclaradoComoLacuna(plano: Plano, medida: Medida): boolean {
  return plano.lacunas.itens.some((lacuna) => lacuna.tipo === 'limite_ausente' && lacuna.medida === medida);
}

export function checarLimitesDoCliente(contexto: ContextoDoGate): ResultadoDaChecagem {
  const { plano, avaliarLimite } = contexto;
  const medidasComLimite = contexto.medidasComLimite as readonly Medida[] | undefined;
  if (medidasComLimite === undefined) {
    return montarResultado(CHAVE_LIMITES_DO_CLIENTE, 'nao_rodou', 'Medidas com limite vigente ausentes no contexto; não dá para conferir a cobertura.', ['limites']);
  }
  const violacoes: string[] = [];
  const naoDeclarados: string[] = [];
  const declarados: string[] = [];
  const incomparaveis: string[] = [];
  const semCobertura: string[] = [];
  const avaliadas = new Set<Medida>();

  const total = plano.orcamento.total;
  if (centavosDe(total) > 0n || medidasComLimite.includes('gasto')) {
    avaliadas.add('gasto');
    const veredito = avaliarLimite('gasto', comoValor(total));
    if (veredito === 'bloqueia') violacoes.push('orcamento (verba total acima do limite)');
    if (veredito === 'sem_regra') {
      if (limiteDeclaradoComoLacuna(plano, 'gasto')) declarados.push('orcamento (limite de gasto ausente, declarado em lacunas)');
      else naoDeclarados.push('orcamento (limite de gasto ausente e não declarado)');
    }
  }

  for (const meta of plano.metas_e_metricas.metas) {
    if (meta.medida_de_limite === undefined) continue;
    const local = `metas_e_metricas/${meta.id}`;
    const valor = previstoComoValor(meta);
    if (valor === null) {
      incomparaveis.push(`${local} (previsto em unidade incomparável com o limite de ${meta.medida_de_limite})`);
      continue;
    }
    avaliadas.add(meta.medida_de_limite);
    const veredito = avaliarLimite(meta.medida_de_limite, valor);
    if (veredito === 'bloqueia') violacoes.push(`${local} (viola limite de ${meta.medida_de_limite})`);
    if (veredito === 'sem_regra') {
      if (limiteDeclaradoComoLacuna(plano, meta.medida_de_limite)) declarados.push(`${local} (limite de ${meta.medida_de_limite} ausente, declarado em lacunas)`);
      else naoDeclarados.push(`${local} (limite de ${meta.medida_de_limite} ausente e não declarado)`);
    }
  }

  const naoAplicaveis = declaracoesDeNaoAplicavel(plano);
  for (const medida of medidasComLimite) {
    if (avaliadas.has(medida)) continue;
    const motivo = naoAplicaveis.get(medida);
    if (motivo !== undefined) {
      declarados.push(`limite de ${medida} declarado como não aplicável: ${motivo}`);
      continue;
    }
    semCobertura.push(`limite vigente de ${medida} sem meta que o avalie nem declaração de que não se aplica`);
  }

  if (violacoes.length > 0 || incomparaveis.length > 0 || semCobertura.length > 0) {
    const motivoGeral =
      violacoes.length > 0
        ? 'Plano viola limite do cliente.'
        : incomparaveis.length > 0
          ? 'Meta com limite em unidade incomparável.'
          : 'Limite vigente do cliente sem cobertura no plano.';
    return reprovar(CHAVE_LIMITES_DO_CLIENTE, motivoGeral, [...violacoes, ...incomparaveis, ...semCobertura, ...naoDeclarados, ...declarados]);
  }
  if (naoDeclarados.length > 0) {
    const motivo = naoDeclarados.some((n) => n.startsWith('orcamento'))
      ? MOTIVO_DE_LIMITE_NAO_DECLARADO
      : 'limite ausente e não declarado em lacunas';
    return reprovar(CHAVE_LIMITES_DO_CLIENTE, motivo, [...naoDeclarados, ...declarados]);
  }
  return aprovar(CHAVE_LIMITES_DO_CLIENTE, 'Limites do cliente respeitados.', declarados);
}
