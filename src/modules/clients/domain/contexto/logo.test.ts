import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashDaLogo, logoDoCliente, TAMANHO_MAXIMO_DA_LOGO_BYTES } from './logo.ts';
import type { ArquivoDeContexto } from './tipos.ts';

const SHA = 'a'.repeat(64);
const arquivo = (id: string, extra: Partial<ArquivoDeContexto> = {}): ArquivoDeContexto => ({
  id,
  secao: 'marca',
  fieldKey: 'logo',
  itemId: null,
  caminho: `orgs/o/clientes/c/arquivos/${id}-logo.png`,
  nome: 'logo.png',
  mime: 'image/png',
  tamanhoBytes: 1000,
  sha256: SHA,
  fonte: 'equipe',
  compartilhavel: false,
  criadoEm: new Date('2026-11-01T00:00:00Z'),
  ...extra,
});

describe('logo do cliente', () => {
  it('escolhe a imagem raster mais recente do campo logo', () => {
    const logo = logoDoCliente([arquivo('velha'), arquivo('nova', { criadoEm: new Date('2026-11-20T00:00:00Z'), mime: 'image/webp' })]);
    assert.equal(logo?.id, 'nova');
    assert.equal(logo?.mime, 'image/webp');
  });

  it('ignora outro campo, item de lista, tipo fora da lista, arquivo grande e hash ausente', () => {
    const recusadas = [
      arquivo('outro-campo', { fieldKey: 'referencias_visuais' }),
      arquivo('de-item', { itemId: 'item-1' }),
      arquivo('pdf', { mime: 'application/pdf' }),
      arquivo('svg', { mime: 'image/svg+xml' }),
      arquivo('grande', { tamanhoBytes: TAMANHO_MAXIMO_DA_LOGO_BYTES + 1 }),
      arquivo('vazia', { tamanhoBytes: 0 }),
      arquivo('sem-hash', { sha256: '' }),
    ];
    assert.equal(logoDoCliente(recusadas), null);
  });
});

describe('hash da logo para o cabeçalho', () => {
  it('sem armazenamento não aponta para uma imagem que não vai abrir', () => {
    assert.equal(hashDaLogo([arquivo('a')], false), null);
    assert.equal(hashDaLogo([arquivo('a')], true), SHA);
    assert.equal(hashDaLogo([], true), null);
  });
});
