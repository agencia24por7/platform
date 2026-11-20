import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COTA_POR_CLIENTE_BYTES,
  TAMANHO_MAXIMO_DO_ARQUIVO_BYTES,
  avaliarArquivo,
  cabeNaCota,
  cabecalhosDeDownload,
  pareceExecutavel,
} from './politicaDeArquivos.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PDF = Buffer.from('%PDF-1.7\n%conteudo');
const ZIP_DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml')]);
const ZIP_XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml')]);
const ZIP_PURO = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('qualquer.txt')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);

function avaliar(nome: string, amostra: Buffer, extra: { tipo?: string; uso?: number; tamanho?: number } = {}) {
  return avaliarArquivo({
    nome,
    contentTypeDeclarado: extra.tipo,
    tamanhoBytes: extra.tamanho ?? amostra.length,
    amostra,
    usoAtualDoClienteBytes: extra.uso ?? 0,
  });
}

function motivoDe(resultado: ReturnType<typeof avaliar>): string {
  return resultado.ok ? 'ok' : resultado.motivo;
}

describe('avaliarArquivo: aceita', () => {
  it('imagens e pdf pelo conteúdo', () => {
    assert.equal(motivoDe(avaliar('logo.png', PNG, { tipo: 'image/png' })), 'ok');
    assert.equal(motivoDe(avaliar('foto.JPG', JPEG, { tipo: 'image/jpeg' })), 'ok');
    assert.equal(motivoDe(avaliar('foto.jpeg', JPEG)), 'ok');
    assert.equal(motivoDe(avaliar('a.webp', WEBP)), 'ok');
    assert.equal(motivoDe(avaliar('manual.pdf', PDF, { tipo: 'application/pdf' })), 'ok');
  });

  it('documentos do Office', () => {
    assert.equal(motivoDe(avaliar('texto.docx', ZIP_DOCX)), 'ok');
    assert.equal(motivoDe(avaliar('planilha.xlsx', ZIP_XLSX)), 'ok');
  });

  it('vídeo mp4 e mov pelo ftyp', () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')]);
    const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  ')]);
    const r = avaliar('depoimento.mp4', mp4, { tipo: 'video/mp4' });
    assert.equal(r.ok && r.contentType, 'video/mp4');
    assert.equal(motivoDe(avaliar('depoimento.mov', mov, { tipo: 'video/quicktime' })), 'ok');
    assert.equal(motivoDe(avaliar('depoimento.mp4', mov)), 'extensao_divergente');
  });

  it('csv e txt em UTF-8, tolerando o tipo genérico do navegador', () => {
    const csv = Buffer.from('nome;preço\nJoão;10\n', 'utf8');
    assert.equal(motivoDe(avaliar('feed.csv', csv, { tipo: 'application/vnd.ms-excel' })), 'ok');
    assert.equal(motivoDe(avaliar('feed.csv', csv, { tipo: 'application/octet-stream' })), 'ok');
    assert.equal(motivoDe(avaliar('depoimento.txt', Buffer.from('ótimo serviço'), { tipo: 'text/plain; charset=utf-8' })), 'ok');
  });

  it('devolve o tipo canônico e o nome seguro, ignorando o tipo declarado equivalente', () => {
    const resultado = avaliar('Logo Final (v2).PNG', PNG, { tipo: 'image/png' });
    assert.ok(resultado.ok);
    assert.equal(resultado.contentType, 'image/png');
    assert.equal(resultado.nomeSeguro, 'logo-final-v2.png');
  });

  it('fontes', () => {
    assert.equal(motivoDe(avaliar('a.woff2', Buffer.from('wOF2....'))), 'ok');
    assert.equal(motivoDe(avaliar('a.otf', Buffer.from('OTTO....'))), 'ok');
    assert.equal(motivoDe(avaliar('a.ttf', Buffer.from([0, 1, 0, 0, 9]))), 'ok');
  });
});

describe('avaliarArquivo: recusa', () => {
  it('zip, mesmo com extensão de Office sem conteúdo de Office', () => {
    assert.equal(motivoDe(avaliar('marca.zip', ZIP_PURO)), 'tipo_nao_permitido');
    assert.equal(motivoDe(avaliar('texto.docx', ZIP_PURO)), 'tipo_nao_permitido');
  });

  it('html, svg e js, mesmo com extensão enganosa', () => {
    assert.equal(motivoDe(avaliar('a.html', Buffer.from('<html><script>1</script>'))), 'tipo_nao_permitido');
    assert.equal(motivoDe(avaliar('a.svg', Buffer.from('<svg onload=alert(1)>'))), 'tipo_nao_permitido');
    assert.equal(motivoDe(avaliar('a.js', Buffer.from('alert(1)'))), 'tipo_nao_permitido');
    assert.equal(motivoDe(avaliar('a.csv', Buffer.from('a,b\n<script>alert(1)</script>'))), 'tipo_nao_permitido');
    assert.equal(motivoDe(avaliar('a.txt', Buffer.from('<!DOCTYPE html>'))), 'tipo_nao_permitido');
  });

  it('executáveis', () => {
    assert.ok(pareceExecutavel(Buffer.from('MZ\x90\x00')));
    assert.equal(motivoDe(avaliar('a.png', Buffer.from('MZ\x90\x00'))), 'conteudo_suspeito');
    assert.equal(motivoDe(avaliar('a.txt', Buffer.from('#!/bin/sh\nrm -rf /'))), 'conteudo_suspeito');
    assert.equal(motivoDe(avaliar('a.pdf', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2]))), 'conteudo_suspeito');
  });

  it('extensão que não bate com o conteúdo', () => {
    assert.equal(motivoDe(avaliar('foto.png', JPEG)), 'extensao_divergente');
    assert.equal(motivoDe(avaliar('foto.pdf', PNG)), 'extensao_divergente');
    assert.equal(motivoDe(avaliar('foto.php', PNG)), 'extensao_divergente');
    assert.equal(motivoDe(avaliar('foto', PNG)), 'extensao_divergente');
    assert.equal(motivoDe(avaliar('doc.docx', ZIP_PURO)), 'tipo_nao_permitido');
  });

  it('Content-Type declarado que contradiz o conteúdo', () => {
    assert.equal(motivoDe(avaliar('a.png', PNG, { tipo: 'text/html' })), 'tipo_divergente');
    assert.equal(motivoDe(avaliar('a.pdf', PDF, { tipo: 'image/png' })), 'tipo_divergente');
  });

  it('binário disfarçado de texto', () => {
    assert.equal(motivoDe(avaliar('a.csv', Buffer.from([0x61, 0x00, 0x62]))), 'tipo_nao_permitido');
    assert.equal(motivoDe(avaliar('a.txt', Buffer.from([0xff, 0xfe, 0xfd]))), 'tipo_nao_permitido');
  });

  it('vazio, grande demais e fora da cota', () => {
    assert.equal(motivoDe(avaliar('a.png', PNG, { tamanho: 0 })), 'arquivo_vazio');
    assert.equal(motivoDe(avaliar('a.png', PNG, { tamanho: TAMANHO_MAXIMO_DO_ARQUIVO_BYTES + 1 })), 'arquivo_grande_demais');
    assert.equal(motivoDe(avaliar('a.png', PNG, { tamanho: TAMANHO_MAXIMO_DO_ARQUIVO_BYTES })), 'ok');
    assert.equal(motivoDe(avaliar('a.png', PNG, { uso: COTA_POR_CLIENTE_BYTES - 5, tamanho: 10 })), 'cota_excedida');
    assert.equal(motivoDe(avaliar('a.png', PNG, { uso: COTA_POR_CLIENTE_BYTES - 12, tamanho: 12 })), 'ok');
  });
});

describe('cabeNaCota', () => {
  it('soma o uso atual ao novo arquivo e aceita exatamente o limite', () => {
    assert.equal(cabeNaCota(0, COTA_POR_CLIENTE_BYTES), true);
    assert.equal(cabeNaCota(1, COTA_POR_CLIENTE_BYTES), false);
  });
});

describe('cabecalhosDeDownload', () => {
  it('força download, sem sniffing, em sandbox e sem cache', () => {
    const cabecalhos = cabecalhosDeDownload('Relatório Final.pdf', 'application/pdf');
    assert.match(cabecalhos['Content-Disposition'] ?? '', /^attachment; filename="relatorio-final\.pdf"; filename\*=UTF-8''relatorio-final\.pdf$/);
    assert.equal(cabecalhos['X-Content-Type-Options'], 'nosniff');
    assert.equal(cabecalhos['Content-Security-Policy'], 'sandbox');
    assert.equal(cabecalhos['Cache-Control'], 'private, no-store');
    assert.equal(cabecalhos['Content-Type'], 'application/pdf');
  });

  it('rebaixa tipo desconhecido para octet-stream e não deixa injetar cabeçalho pelo nome', () => {
    const cabecalhos = cabecalhosDeDownload('x"\r\nSet-Cookie: a=b.html', 'text/html');
    assert.equal(cabecalhos['Content-Type'], 'application/octet-stream');
    assert.doesNotMatch(cabecalhos['Content-Disposition'] ?? '', /[\r\n]/);
    assert.doesNotMatch(cabecalhos['Content-Disposition'] ?? '', /Set-Cookie: /);
  });
});
