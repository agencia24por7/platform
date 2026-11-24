import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { campoEhHerdado, herdarDoCadastro, type CadastroDoCliente } from './heranca.ts';
import type { ContextoBruto, EntradaDeCampo } from './tipos.ts';

const CADASTRO: CadastroDoCliente = { nome: 'Credaz', segmento: 'Empréstimo', modeloDeOperacao: 'leads', temRede: false, redeNome: null, criadoEm: new Date('2026-11-01T00:00:00Z') };
const VAZIO: ContextoBruto = { campos: [], itens: [], arquivos: [] };

function entrada(fieldKey: string, valor: unknown, versao = 3): EntradaDeCampo {
  return { secao: 'empresa', fieldKey, valor, versao, atualizadoEm: new Date(), atualizadoPor: 'u', viaLink: false, epistemico: 'fato', fonte: 'equipe', revisao: 'confirmado', compartilhavel: true };
}

describe('herança do cadastro', () => {
  it('preenche nome e segmento quando não há entrada', () => {
    const r = herdarDoCadastro(VAZIO, CADASTRO);
    assert.deepEqual(r.campos.map((c) => [c.fieldKey, c.valor, c.versao]), [['nome_empresa', 'Credaz', 0], ['segmento', 'Empréstimo', 0]]);
  });

  it('entrada salva da pessoa vence o cadastro', () => {
    const salvo = { campos: [entrada('nome_empresa', 'Credaz Financeira')], itens: [], arquivos: [] };
    const r = herdarDoCadastro(salvo, CADASTRO);
    assert.equal(r.campos.find((c) => c.fieldKey === 'nome_empresa')?.valor, 'Credaz Financeira');
    assert.equal(r.campos.filter((c) => c.fieldKey === 'nome_empresa').length, 1);
  });

  it('segmento vazio ou em branco não vira entrada', () => {
    assert.equal(herdarDoCadastro(VAZIO, { ...CADASTRO, segmento: null }).campos.length, 1);
    assert.equal(herdarDoCadastro(VAZIO, { ...CADASTRO, segmento: '   ' }).campos.length, 1);
  });

  it('entrada herdada nunca é compartilhável e é reconhecida pela versão zero', () => {
    const r = herdarDoCadastro(VAZIO, CADASTRO);
    assert.ok(r.campos.every((c) => !c.compartilhavel && campoEhHerdado(c)));
    assert.equal(campoEhHerdado(entrada('nome_empresa', 'x')), false);
  });

  it('não altera o contexto de entrada', () => {
    herdarDoCadastro(VAZIO, CADASTRO);
    assert.equal(VAZIO.campos.length, 0);
  });
});
