import { createHash, timingSafeEqual } from 'node:crypto';

export type Ator = {
  readonly userId: string | null;
  readonly requestId: string;
  readonly sourceIp: string | null;
};

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function enderecoConfiavel(encaminhado: string | null | undefined): string | null {
  if (!encaminhado) return null;

  const partes = encaminhado.split(',');
  const ultimo = partes[partes.length - 1]?.trim() ?? '';
  if (ultimo.length === 0 || ultimo.length > 45) return null;

  const semPorta = IPV4.test(ultimo.split(':')[0] ?? '') ? (ultimo.split(':')[0] ?? '') : ultimo;
  return /^[0-9a-f.:]+$/i.test(semPorta) ? semPorta : null;
}

export type CabecalhosDoPedido = { get(nome: string): string | null };

export type ConfiancaNoProxy = {
  readonly segredo: string | undefined;
  readonly producao: boolean;
};

const impressaoDe = (valor: string): Buffer => createHash('sha256').update(valor).digest();

export function provaDoProxyValida(apresentada: string | null | undefined, segredo: string): boolean {
  if (!apresentada || segredo.length === 0) return false;
  return timingSafeEqual(impressaoDe(apresentada), impressaoDe(segredo));
}

export function enderecoDoPedido(cabecalhos: CabecalhosDoPedido, confianca: ConfiancaNoProxy): string | null {
  const encaminhado = cabecalhos.get('x-forwarded-for');
  if (!confianca.segredo) return confianca.producao ? null : enderecoConfiavel(encaminhado);
  return provaDoProxyValida(cabecalhos.get('x-orla-borda'), confianca.segredo) ? enderecoConfiavel(encaminhado) : null;
}
