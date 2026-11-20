import type { Epistemico, Fonte, Revisao, SecaoKey } from './catalogo.ts';
import { localizarCampo } from './catalogo.ts';
import type { ArquivoDeContexto, EntradaDeCampo, ItemDeLista } from './tipos.ts';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const CLIENTE = '22222222-2222-4222-8222-222222222222';
export const DATA = new Date('2026-11-20T12:00:00.000Z');

type Marcas = { epistemico?: Epistemico; fonte?: Fonte; revisao?: Revisao; compartilhavel?: boolean };

function secaoDe(key: string): SecaoKey {
  const achado = localizarCampo(key);
  if (!achado) throw new Error(`campo ${key} não existe no catálogo`);
  return achado.secao.key;
}

export function entrada(fieldKey: string, valor: unknown, marcas: Marcas = {}): EntradaDeCampo {
  return {
    secao: secaoDe(fieldKey),
    fieldKey,
    valor,
    versao: 1,
    atualizadoEm: DATA,
    atualizadoPor: null,
    viaLink: false,
    epistemico: marcas.epistemico ?? 'fato',
    fonte: marcas.fonte ?? 'equipe',
    revisao: marcas.revisao ?? 'confirmado',
    compartilhavel: marcas.compartilhavel ?? false,
  };
}

let contador = 0;

export function item(listKey: string, dados: Record<string, unknown>, marcas: Marcas & { id?: string; posicao?: number } = {}): ItemDeLista {
  contador += 1;
  return {
    id: marcas.id ?? `00000000-0000-4000-8000-${contador.toString().padStart(12, '0')}`,
    secao: secaoDe(listKey),
    listKey,
    posicao: marcas.posicao ?? contador,
    dados,
    versao: 1,
    atualizadoEm: DATA,
    viaLink: false,
    epistemico: marcas.epistemico ?? 'fato',
    fonte: marcas.fonte ?? 'equipe',
    revisao: marcas.revisao ?? 'confirmado',
    compartilhavel: marcas.compartilhavel ?? false,
  };
}

export function anexo(fieldKey: string, nome: string, id = '33333333-3333-4333-8333-333333333333'): ArquivoDeContexto {
  return {
    id,
    secao: secaoDe(fieldKey),
    fieldKey,
    itemId: null,
    caminho: `orgs/${ORG}/clientes/${CLIENTE}/arquivos/${id}-${nome}`,
    nome,
    mime: 'image/png',
    tamanhoBytes: 1024,
    sha256: 'a'.repeat(64),
    fonte: 'cliente',
    compartilhavel: true,
    criadoEm: DATA,
  };
}
