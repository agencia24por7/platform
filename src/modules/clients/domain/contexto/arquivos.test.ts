import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COTA_POR_CLIENTE,
  MB,
  TIPOS_PERMITIDOS,
  assinaturaConfere,
  avaliarArquivo,
  caminhoDoArquivo,
  caminhoPertenceAoCliente,
  nomeSeguro,
  prefixoDoBrain,
  prefixoDoCliente,
} from './arquivos.ts';
import { CLIENTE, ORG } from './fixturesDeTeste.ts';

const pedido = (nome: string, mime: string, extra: Partial<Parameters<typeof avaliarArquivo>[0]> = {}) =>
  avaliarArquivo({
    nome,
    mime,
    tamanhoBytes: 1000,
    categoriasAceitas: ['imagem', 'documento', 'planilha', 'video'],
    usoAtualDoClienteBytes: 0,
    ...extra,
  });

const motivo = (r: ReturnType<typeof avaliarArquivo>) => (r.ok ? 'ok' : r.motivo);

describe('política de arquivos', () => {
  it('aceita a lista permitida', () => {
    for (const [nome, mime] of [
      ['logo.PNG', 'image/png'],
      ['foto.jpeg', 'image/jpeg'],
      ['manual.pdf', 'application/pdf'],
      ['produtos.csv', 'text/csv; charset=utf-8'],
      ['produtos.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['video.mp4', 'video/mp4'],
    ]) {
      assert.equal(motivo(pedido(nome!, mime!)), 'ok', nome);
    }
  });

  it('recusa SVG, HTML, executáveis e ZIP', () => {
    for (const [nome, mime] of [
      ['logo.svg', 'image/svg+xml'],
      ['pagina.html', 'text/html'],
      ['setup.exe', 'application/x-msdownload'],
      ['pacote.zip', 'application/zip'],
    ]) {
      assert.equal(motivo(pedido(nome!, mime!)), 'tipo_nao_permitido', nome);
    }
  });

  it('extensão precisa combinar com o tipo', () => {
    assert.equal(motivo(pedido('logo.html', 'image/png')), 'extensao_divergente');
  });

  it('respeita a categoria do campo, o tamanho e a cota', () => {
    assert.equal(motivo(pedido('manual.pdf', 'application/pdf', { categoriasAceitas: ['imagem'] })), 'categoria_nao_aceita');
    assert.equal(motivo(pedido('a.png', 'image/png', { tamanhoBytes: 0 })), 'vazio');
    assert.equal(motivo(pedido('a.png', 'image/png', { tamanhoBytes: 25 * MB + 1 })), 'grande_demais');
    assert.equal(motivo(pedido('a.png', 'image/png', { usoAtualDoClienteBytes: COTA_POR_CLIENTE - 10 })), 'cota_excedida');
  });

  it('confere a assinatura dos primeiros bytes', () => {
    const tipo = (mime: string) => TIPOS_PERMITIDOS.find((t) => t.mime === mime)!;
    assert.ok(assinaturaConfere(tipo('image/png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])));
    assert.ok(!assinaturaConfere(tipo('image/png'), new TextEncoder().encode('<svg onload=alert(1)>')));
    assert.ok(assinaturaConfere(tipo('application/pdf'), new TextEncoder().encode('%PDF-1.7')));
    assert.ok(assinaturaConfere(tipo('text/csv'), new TextEncoder().encode('nome,preco\nA,10')));
    assert.ok(!assinaturaConfere(tipo('text/csv'), new TextEncoder().encode('<html>')));
    assert.ok(!assinaturaConfere(tipo('text/plain'), new Uint8Array([0x4d, 0x5a, 0x00, 0x01])));
  });
});

describe('caminhos no armazenamento', () => {
  it('um prefixo por organização e cliente', () => {
    assert.equal(prefixoDoCliente(ORG, CLIENTE), `orgs/${ORG}/clientes/${CLIENTE}/`);
    assert.equal(prefixoDoBrain(ORG, CLIENTE), `orgs/${ORG}/clientes/${CLIENTE}/contexto/brain/`);
  });

  it('arquivo fica sob arquivos/{id}-{nome seguro}', () => {
    const id = '55555555-5555-4555-8555-555555555555';
    assert.equal(
      caminhoDoArquivo(ORG, CLIENTE, id, '../../Manual da Marca (2026).PDF'),
      `orgs/${ORG}/clientes/${CLIENTE}/contexto/arquivos/${id}-manual-da-marca-2026.pdf`,
    );
  });

  it('recusa id que não é uuid para não montar caminho fora do prefixo', () => {
    assert.throws(() => prefixoDoCliente('../outra', CLIENTE));
    assert.throws(() => caminhoDoArquivo(ORG, CLIENTE, 'x/../y', 'a.png'));
  });

  it('nome seguro tira acento, espaço, barra e mantém extensão', () => {
    assert.equal(nomeSeguro('Ação Promocional.JPG'), 'acao-promocional.jpg');
    assert.equal(nomeSeguro('.htaccess'), 'arquivo.htaccess');
    assert.equal(nomeSeguro('////'), 'arquivo');
    assert.ok(nomeSeguro(`${'a'.repeat(300)}.png`).length <= 80);
  });

  it('confere se um caminho pertence ao cliente', () => {
    assert.ok(caminhoPertenceAoCliente(`orgs/${ORG}/clientes/${CLIENTE}/contexto/x`, ORG, CLIENTE));
    assert.ok(!caminhoPertenceAoCliente(`orgs/${ORG}/clientes/${CLIENTE}/../outro/x`, ORG, CLIENTE));
  });
});
