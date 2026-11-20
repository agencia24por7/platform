import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  caminhoDoArquivo,
  caminhoDoContexto,
  nomeSeguro,
  prefixoDoCliente,
  validarCaminho,
  validarPrefixo,
} from './caminhos.ts';
import { CaminhoInvalidoError } from './tipos.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const ARQUIVO = '33333333-3333-4333-8333-333333333333';
const BASE = `orgs/${ORG}/clientes/${CLIENTE}/`;

describe('nomeSeguro', () => {
  it('remove acentos, normaliza e mantém a extensão', () => {
    assert.equal(nomeSeguro('Relatório Anual 2025.PDF'), 'relatorio-anual-2025.pdf');
    assert.equal(nomeSeguro('ﬁnal Ⅻ.png'), 'final-xii.png');
  });

  it('impede travessia, barras e arquivo oculto', () => {
    assert.equal(nomeSeguro('../../etc/passwd'), 'passwd');
    assert.equal(nomeSeguro('..\\..\\x.png'), 'x.png');
    assert.equal(nomeSeguro('.htaccess'), 'htaccess');
    assert.equal(nomeSeguro('.env.png'), 'env.png');
  });

  it('não preserva dupla extensão', () => {
    assert.equal(nomeSeguro('shell.php.png'), 'shell-php.png');
  });

  it('limita o tamanho e cai num nome padrão quando nada sobra', () => {
    assert.ok(nomeSeguro(`${'a'.repeat(500)}.png`).length <= 80 + 1 + 8);
    assert.equal(nomeSeguro('???.png'), 'arquivo.png');
    assert.equal(nomeSeguro(''), 'arquivo');
    assert.equal(nomeSeguro('日本語.pdf'), 'arquivo.pdf');
  });

  it('só emite caracteres da lista permitida', () => {
    const resultado = nomeSeguro('a\u0000b\r\nc"d;e|f<g>.p‮ng');
    assert.match(resultado, /^[a-z0-9._-]+$/);
  });
});

describe('construção de caminhos', () => {
  it('monta o caminho do arquivo e do contexto', () => {
    assert.equal(caminhoDoArquivo(ORG, CLIENTE, ARQUIVO, 'Logo Nova.PNG'), `${BASE}arquivos/${ARQUIVO}-logo-nova.png`);
    assert.equal(caminhoDoContexto(ORG, CLIENTE, 'marca', 'v1.json'), `${BASE}contexto/marca/v1.json`);
    assert.equal(prefixoDoCliente(ORG, CLIENTE), BASE);
  });

  it('recusa identificadores que não são UUID', () => {
    assert.throws(() => prefixoDoCliente('../x', CLIENTE), CaminhoInvalidoError);
    assert.throws(() => prefixoDoCliente(ORG, `${CLIENTE}/..`), CaminhoInvalidoError);
    assert.throws(() => caminhoDoArquivo(ORG, CLIENTE, 'x', 'a.png'), CaminhoInvalidoError);
    assert.throws(() => prefixoDoCliente('AAAAAAAA-1111-4111-8111-111111111111', CLIENTE), CaminhoInvalidoError);
  });

  it('recusa segmento de contexto com travessia', () => {
    assert.throws(() => caminhoDoContexto(ORG, CLIENTE, '..', 'x'), CaminhoInvalidoError);
    assert.throws(() => caminhoDoContexto(ORG, CLIENTE, 'a/../b'), CaminhoInvalidoError);
    assert.throws(() => caminhoDoContexto(ORG, CLIENTE), CaminhoInvalidoError);
  });
});

describe('validarCaminho', () => {
  it('aceita caminho válido', () => {
    assert.equal(validarCaminho(`${BASE}contexto/marca.json`), `${BASE}contexto/marca.json`);
  });

  it('recusa fora do prefixo, travessia, barra dupla, controle e outro cliente', () => {
    const ruins = [
      'orgs/x/clientes/y/contexto/a',
      `${BASE}../${CLIENTE}/a`,
      `${BASE}contexto//a`,
      `${BASE}contexto/./a`,
      `${BASE}contexto/a\u0000b`,
      `${BASE}contexto/a\nb`,
      `${BASE}contexto/a\\b`,
      `${BASE}contexto/.oculto`,
      `${BASE}contexto/a b`,
      `${BASE}`,
      `${BASE}contexto/`,
      `/${BASE}contexto/a`,
      `_saude/canario`,
      `orgs/${ORG}/clientes/${CLIENTE}x/contexto/a`,
      `${BASE}${'a/'.repeat(500)}b`,
    ];
    for (const ruim of ruins) {
      assert.throws(() => validarCaminho(ruim), CaminhoInvalidoError, JSON.stringify(ruim));
    }
  });

  it('exige o prefixo esperado quando informado', () => {
    const outro = `orgs/${ORG}/clientes/44444444-4444-4444-8444-444444444444/`;
    assert.throws(() => validarCaminho(`${outro}contexto/a`, BASE), CaminhoInvalidoError);
    assert.equal(validarCaminho(`${BASE}contexto/a`, BASE), `${BASE}contexto/a`);
  });
});

describe('validarPrefixo', () => {
  it('aceita o prefixo do cliente e subprefixos', () => {
    assert.equal(validarPrefixo(BASE), BASE);
    assert.equal(validarPrefixo(`${BASE}arquivos/`), `${BASE}arquivos/`);
  });

  it('exige barra final quando pedido, para não casar com nomes parecidos', () => {
    assert.throws(() => validarPrefixo(`${BASE}arquivos`, { exigirBarraFinal: true }), CaminhoInvalidoError);
    assert.equal(validarPrefixo(BASE, { exigirBarraFinal: true }), BASE);
  });

  it('recusa prefixo de organização inteira ou vazio', () => {
    assert.throws(() => validarPrefixo(`orgs/${ORG}/`), CaminhoInvalidoError);
    assert.throws(() => validarPrefixo(''), CaminhoInvalidoError);
    assert.throws(() => validarPrefixo('orgs/'), CaminhoInvalidoError);
  });
});
