import { iguais } from './jsonEstavel.ts';
import type { ContextoBruto, DadosDoItem } from './tipos.ts';

export type Mudanca = 'adicionado' | 'removido' | 'alterado';

export type Instantaneo = {
  readonly campos: Readonly<Record<string, unknown>>;
  readonly itens: Readonly<Record<string, readonly { readonly id: string; readonly dados: DadosDoItem }[]>>;
};

export type DiferencaDeChave = { readonly chave: string; readonly antes: unknown; readonly depois: unknown };

export type Diferenca =
  | {
      readonly tipo: 'campo';
      readonly fieldKey: string;
      readonly mudanca: Mudanca;
      readonly antes: unknown;
      readonly depois: unknown;
    }
  | {
      readonly tipo: 'item';
      readonly listKey: string;
      readonly itemId: string;
      readonly mudanca: Mudanca;
      readonly campos: readonly DiferencaDeChave[];
    };

export function instantaneo(contexto: Pick<ContextoBruto, 'campos' | 'itens'>): Instantaneo {
  const itens: Record<string, { id: string; dados: DadosDoItem }[]> = {};
  for (const item of [...contexto.itens].sort((a, b) => a.posicao - b.posicao || a.id.localeCompare(b.id))) {
    (itens[item.listKey] ??= []).push({ id: item.id, dados: item.dados });
  }
  return {
    campos: Object.fromEntries(contexto.campos.map((entrada) => [entrada.fieldKey, entrada.valor])),
    itens,
  };
}

export function diferencasDeDados(antes: DadosDoItem | null, depois: DadosDoItem | null): readonly DiferencaDeChave[] {
  const chaves = [...new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})])].sort();
  return chaves
    .map((chave) => ({ chave, antes: antes?.[chave] ?? null, depois: depois?.[chave] ?? null }))
    .filter((d) => !iguais(d.antes, d.depois));
}

function mudancaDe(antes: unknown, depois: unknown): Mudanca | null {
  const tinha = antes !== undefined && antes !== null;
  const tem = depois !== undefined && depois !== null;
  if (!tinha && tem) return 'adicionado';
  if (tinha && !tem) return 'removido';
  if (tinha && tem && !iguais(antes, depois)) return 'alterado';
  return null;
}

export function diferencas(antes: Instantaneo, depois: Instantaneo): readonly Diferenca[] {
  const resultado: Diferenca[] = [];

  const chaves = [...new Set([...Object.keys(antes.campos), ...Object.keys(depois.campos)])].sort();
  for (const fieldKey of chaves) {
    const mudanca = mudancaDe(antes.campos[fieldKey], depois.campos[fieldKey]);
    if (mudanca) {
      resultado.push({
        tipo: 'campo',
        fieldKey,
        mudanca,
        antes: antes.campos[fieldKey] ?? null,
        depois: depois.campos[fieldKey] ?? null,
      });
    }
  }

  const listas = [...new Set([...Object.keys(antes.itens), ...Object.keys(depois.itens)])].sort();
  for (const listKey of listas) {
    const velhos = new Map((antes.itens[listKey] ?? []).map((item) => [item.id, item.dados]));
    const novos = new Map((depois.itens[listKey] ?? []).map((item) => [item.id, item.dados]));
    const ids = [...new Set([...velhos.keys(), ...novos.keys()])].sort();
    for (const itemId of ids) {
      const mudanca = mudancaDe(velhos.get(itemId), novos.get(itemId));
      if (!mudanca) continue;
      resultado.push({
        tipo: 'item',
        listKey,
        itemId,
        mudanca,
        campos: diferencasDeDados(velhos.get(itemId) ?? null, novos.get(itemId) ?? null),
      });
    }
  }

  return resultado;
}
