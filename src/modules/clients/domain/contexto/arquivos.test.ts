import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATEGORIA_DO_TIPO, avaliarAnexo, caminhoDoArquivo, caminhoDoBrain, prefixoDoCliente } from './arquivos.ts';
import { TIPOS_PERMITIDOS } from '../../../../shared/storage/politicaDeArquivos.ts';
import { CLIENTE, ORG } from './fixturesDeTeste.ts';
import type { CategoriaDeArquivo } from './catalogo.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x61, 0x2e, 0x74, 0x78, 0x74]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypisom')]);
const WOFF2 = new TextEncoder().encode('wOF2....');

const TODAS: readonly CategoriaDeArquivo[] = ['imagem', 'documento', 'planilha', 'video', 'fonte'];

const anexo = (nome: string, mime: string, conteudo: Uint8Array, categorias: readonly CategoriaDeArquivo[] = TODAS) =>
  avaliarAnexo({ nome, mime, conteudo, categoriasAceitas: categorias, usoAtualDoClienteBytes: 0 });

const motivo = (r: ReturnType<typeof anexo>) => (r.ok ? 'ok' : r.motivo);

describe('política de anexos do contexto', () => {
  it('todo tipo permitido tem categoria do catálogo, e zip não é permitido', () => {
    assert.deepEqual(Object.keys(CATEGORIA_DO_TIPO).sort(), Object.keys(TIPOS_PERMITIDOS).sort());
    assert.ok(!('zip' in TIPOS_PERMITIDOS));
  });

  it('aceita imagem, vídeo e fonte pelo conteúdo', () => {
    assert.equal(motivo(anexo('logo.png', 'image/png', PNG)), 'ok');
    assert.equal(motivo(anexo('depoimento.mp4', 'video/mp4', MP4)), 'ok');
    assert.equal(motivo(anexo('marca.woff2', 'font/woff2', WOFF2)), 'ok');
  });

  it('recusa zip, svg e categoria que o campo não aceita', () => {
    assert.equal(motivo(anexo('pacote.zip', 'application/zip', ZIP)), 'tipo_nao_permitido');
    assert.equal(motivo(anexo('logo.svg', 'image/svg+xml', new TextEncoder().encode('<svg/>'))), 'tipo_nao_permitido');
    assert.equal(motivo(anexo('manual.pdf', 'application/pdf', new TextEncoder().encode('%PDF-1.7'), ['imagem'])), 'categoria_nao_aceita');
  });

  it('conteúdo que não bate com o tipo é recusado', () => {
    assert.equal(motivo(anexo('logo.png', 'image/png', new TextEncoder().encode('<html>'))), 'tipo_nao_permitido');
  });
});

describe('caminhos no armazenamento', () => {
  it('um prefixo por organização e cliente, brain sob contexto/brain', () => {
    assert.equal(prefixoDoCliente(ORG, CLIENTE), `orgs/${ORG}/clientes/${CLIENTE}/`);
    assert.equal(caminhoDoBrain(ORG, CLIENTE, 'perfil.md'), `orgs/${ORG}/clientes/${CLIENTE}/contexto/brain/perfil.md`);
  });

  it('arquivo fica sob arquivos/{id}-{nome seguro} e recusa id que não é uuid', () => {
    const id = '55555555-5555-4555-8555-555555555555';
    assert.equal(
      caminhoDoArquivo(ORG, CLIENTE, id, 'Manual da Marca (2026).PDF'),
      `orgs/${ORG}/clientes/${CLIENTE}/arquivos/${id}-manual-da-marca-2026.pdf`,
    );
    assert.throws(() => prefixoDoCliente('../outra', CLIENTE));
    assert.throws(() => caminhoDoArquivo(ORG, CLIENTE, 'x/../y', 'a.png'));
  });
});
