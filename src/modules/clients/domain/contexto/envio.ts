import { TAMANHO_MAXIMO_DO_ARQUIVO } from './arquivos.ts';

export const ORCAMENTO_DO_LINK_BYTES_POR_HORA = 200 * 1024 * 1024;
export const ENVIOS_DO_LINK_POR_HORA = 60;
export const ENVIOS_SIMULTANEOS_POR_REPLICA = 4;

const CHAVE = /^[a-z][a-z0-9_]{0,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIME = /^[a-z0-9][a-z0-9.+-]{0,59}\/[a-z0-9][a-z0-9.+-]{0,59}$/;
const CONTROLE = /[\u0000-\u001f\u007f]/;

export type PedidoDeEnvio = {
  readonly fieldKey: string;
  readonly listKey: string | null;
  readonly itemId: string | null;
  readonly nome: string;
  readonly mime: string;
  readonly tamanhoDeclarado: number;
};

export type CabecalhosBrutos = {
  readonly campo: string | null;
  readonly lista: string | null;
  readonly item: string | null;
  readonly nome: string | null;
  readonly tipo: string | null;
  readonly tamanho: string | null;
};

export type MotivoDoPedido = 'incompleto' | 'tamanho_ausente' | 'acima_do_limite' | 'vazio' | 'invalido';

export type PedidoLido = { readonly ok: true; readonly pedido: PedidoDeEnvio } | { readonly ok: false; readonly motivo: MotivoDoPedido };

function decodificar(bruto: string | null): string | null {
  if (bruto === null) return null;
  try {
    const valor = decodeURIComponent(bruto).trim();
    return valor.length > 0 ? valor : null;
  } catch {
    return null;
  }
}

function tamanhoDeclarado(bruto: string | null): number | null {
  if (bruto === null || !/^[0-9]{1,12}$/.test(bruto.trim())) return null;
  return Number(bruto.trim());
}

export function lerPedidoDeEnvio(brutos: CabecalhosBrutos): PedidoLido {
  const fieldKey = decodificar(brutos.campo);
  const nome = decodificar(brutos.nome);
  const listKey = decodificar(brutos.lista);
  const itemId = decodificar(brutos.item);
  if (!fieldKey || !nome) return { ok: false, motivo: 'incompleto' };
  if (!CHAVE.test(fieldKey) || (listKey !== null && !CHAVE.test(listKey))) return { ok: false, motivo: 'invalido' };
  if (itemId !== null && !UUID.test(itemId)) return { ok: false, motivo: 'invalido' };
  if ((listKey === null) !== (itemId === null)) return { ok: false, motivo: 'invalido' };
  if (nome.length > 255 || CONTROLE.test(nome)) return { ok: false, motivo: 'invalido' };

  const mime = (brutos.tipo ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
  if (!MIME.test(mime)) return { ok: false, motivo: 'invalido' };

  const tamanho = tamanhoDeclarado(brutos.tamanho);
  if (tamanho === null) return { ok: false, motivo: 'tamanho_ausente' };
  if (tamanho === 0) return { ok: false, motivo: 'vazio' };
  if (tamanho > TAMANHO_MAXIMO_DO_ARQUIVO) return { ok: false, motivo: 'acima_do_limite' };

  return { ok: true, pedido: { fieldKey, listKey, itemId, nome, mime, tamanhoDeclarado: tamanho } };
}

export type Semaforo = { tentar(): (() => void) | null; readonly emUso: () => number };

export function criarSemaforo(vagas: number): Semaforo {
  let ocupadas = 0;
  return {
    tentar() {
      if (ocupadas >= vagas) return null;
      ocupadas += 1;
      let liberado = false;
      return () => {
        if (liberado) return;
        liberado = true;
        ocupadas -= 1;
      };
    },
    emUso: () => ocupadas,
  };
}

export async function lerAteOLimite(
  corpo: ReadableStream<Uint8Array> | null,
  esperado: number,
): Promise<{ readonly ok: true; readonly conteudo: Uint8Array } | { readonly ok: false; readonly motivo: 'acima_do_declarado' | 'incompleto' }> {
  if (!corpo) return { ok: false, motivo: 'incompleto' };
  const leitor = corpo.getReader();
  const conteudo = new Uint8Array(esperado);
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    if (total + value.byteLength > esperado) {
      await leitor.cancel().catch(() => undefined);
      return { ok: false, motivo: 'acima_do_declarado' };
    }
    conteudo.set(value, total);
    total += value.byteLength;
  }
  if (total !== esperado) return { ok: false, motivo: 'incompleto' };
  return { ok: true, conteudo };
}
