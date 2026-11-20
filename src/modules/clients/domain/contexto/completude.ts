import { CATALOGO, type Campo, type Nivel, type SecaoKey } from './catalogo.ts';
import type { ContextoBruto, EntradaDeCampo } from './tipos.ts';
import { valorPreenchido } from './valores.ts';

export const PESO_POR_NIVEL: Record<Nivel, number> = { essencial: 3, aprofundar: 1 };

export type CompletudeDaSecao = {
  readonly secao: SecaoKey;
  readonly percentual: number;
  readonly preenchidos: number;
  readonly total: number;
  readonly essenciaisPreenchidos: number;
  readonly essenciaisTotal: number;
  readonly essenciaisCompletos: boolean;
};

export type Completude = {
  readonly geral: number;
  readonly essenciaisCompletos: boolean;
  readonly secoes: readonly CompletudeDaSecao[];
};

export type MotivoDaFalta = 'vazio' | 'itens_insuficientes' | 'sugestao_pendente';

export type CampoFaltando = {
  readonly secao: SecaoKey;
  readonly fieldKey: string;
  readonly rotulo: string;
  readonly nivel: Nivel;
  readonly motivo: MotivoDaFalta;
  readonly faltamItens: number;
};

type Indices = {
  readonly entradas: ReadonlyMap<string, EntradaDeCampo>;
  readonly itensConfirmados: ReadonlyMap<string, number>;
  readonly itensSugeridos: ReadonlyMap<string, number>;
  readonly camposComArquivo: ReadonlySet<string>;
};

function indexar(contexto: ContextoBruto): Indices {
  const itensConfirmados = new Map<string, number>();
  const itensSugeridos = new Map<string, number>();
  for (const item of contexto.itens) {
    const alvo = item.revisao === 'confirmado' ? itensConfirmados : itensSugeridos;
    alvo.set(item.listKey, (alvo.get(item.listKey) ?? 0) + 1);
  }
  return {
    entradas: new Map(contexto.campos.map((entrada) => [entrada.fieldKey, entrada])),
    itensConfirmados,
    itensSugeridos,
    camposComArquivo: new Set(contexto.arquivos.filter((a) => a.itemId === null).map((a) => a.fieldKey)),
  };
}

function fracao(campo: Campo, indices: Indices): number {
  if (campo.tipo === 'lista') {
    const confirmados = indices.itensConfirmados.get(campo.key) ?? 0;
    return Math.min(confirmados / Math.max(campo.minimo, 1), 1);
  }
  const entrada = indices.entradas.get(campo.key);
  const confirmada = entrada?.revisao === 'confirmado' && valorPreenchido(entrada.valor);
  if (confirmada) return 1;
  return campo.tipo === 'arquivo' && indices.camposComArquivo.has(campo.key) ? 1 : 0;
}

function contam(campos: readonly Campo[]): readonly Campo[] {
  return campos.filter((campo) => campo.contaNaCompletude);
}

function percentual(soma: number, total: number): number {
  return total === 0 ? 100 : Math.round((soma / total) * 100);
}

export function calcularCompletude(contexto: ContextoBruto): Completude {
  const indices = indexar(contexto);
  let somaGeral = 0;
  let pesoGeral = 0;

  const secoes = CATALOGO.map((secao): CompletudeDaSecao => {
    let soma = 0;
    let peso = 0;
    let preenchidos = 0;
    let essenciaisPreenchidos = 0;
    const campos = contam(secao.campos);
    const essenciais = campos.filter((campo) => campo.nivel === 'essencial');

    for (const campo of campos) {
      const parte = fracao(campo, indices);
      const pesoDoCampo = PESO_POR_NIVEL[campo.nivel];
      soma += parte * pesoDoCampo;
      peso += pesoDoCampo;
      if (parte === 1) {
        preenchidos += 1;
        if (campo.nivel === 'essencial') essenciaisPreenchidos += 1;
      }
    }

    somaGeral += soma;
    pesoGeral += peso;

    return {
      secao: secao.key,
      percentual: percentual(soma, peso),
      preenchidos,
      total: campos.length,
      essenciaisPreenchidos,
      essenciaisTotal: essenciais.length,
      essenciaisCompletos: essenciaisPreenchidos === essenciais.length,
    };
  });

  return {
    geral: percentual(somaGeral, pesoGeral),
    essenciaisCompletos: secoes.every((s) => s.essenciaisCompletos),
    secoes,
  };
}

function motivo(campo: Campo, indices: Indices): MotivoDaFalta {
  if (campo.tipo === 'lista') {
    return (indices.itensSugeridos.get(campo.key) ?? 0) > 0 ? 'sugestao_pendente' : 'itens_insuficientes';
  }
  return indices.entradas.get(campo.key)?.revisao === 'sugerido' ? 'sugestao_pendente' : 'vazio';
}

export function proximosCampos(
  contexto: ContextoBruto,
  limite = 5,
  secoes: readonly string[] | null = null,
): readonly CampoFaltando[] {
  const indices = indexar(contexto);
  const faltando: CampoFaltando[] = [];

  for (const nivel of ['essencial', 'aprofundar'] as const) {
    for (const secao of CATALOGO) {
      if (secoes && !secoes.includes(secao.key)) continue;
      for (const campo of contam(secao.campos)) {
        if (campo.nivel !== nivel || fracao(campo, indices) === 1) continue;
        const confirmados = campo.tipo === 'lista' ? (indices.itensConfirmados.get(campo.key) ?? 0) : 0;
        faltando.push({
          secao: secao.key,
          fieldKey: campo.key,
          rotulo: campo.rotulo,
          nivel,
          motivo: motivo(campo, indices),
          faltamItens: campo.tipo === 'lista' ? Math.max(campo.minimo - confirmados, 0) : 0,
        });
        if (faltando.length >= limite) return faltando;
      }
    }
  }
  return faltando;
}
