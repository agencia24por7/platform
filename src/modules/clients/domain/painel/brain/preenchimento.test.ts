import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entradaPreenchida, separarPorPreenchimento } from './preenchimento.ts';
import type { EntradaDoBrain, TipoDeEntrada } from './tipos.ts';

function entrada(tipo: TipoDeEntrada, ajuste: { linhas?: number | null; dias?: number | null; completude?: number } = {}): EntradaDoBrain {
  return {
    urn: `urn:${tipo}`,
    tipo,
    titulo: tipo,
    descricao: '',
    provedor: null,
    esquema: [],
    grao: null,
    cobertura: { desde: null, ate: null, linhas: ajuste.linhas ?? null, diasComDado: ajuste.dias ?? null, ultimos90Dias: null },
    frescor: { status: 'desconhecido', ultimaAtualizacao: null },
    qualidade: { completude: ajuste.completude ?? 0, avisos: [] },
    acesso: { via: 'derivado', receita: '' },
    sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido' },
    tags: [],
    relacoes: [],
  };
}

describe('entrada preenchida do Brain', () => {
  it('conexão, fonte e arquivo existem, logo contam', () => {
    for (const tipo of ['conexao', 'fonte', 'arquivo'] as const) assert.equal(entradaPreenchida(entrada(tipo)), true);
  });

  it('tabela só conta com linhas ou dias de dado', () => {
    assert.equal(entradaPreenchida(entrada('tabela_de_dados')), false);
    assert.equal(entradaPreenchida(entrada('tabela_de_dados', { linhas: 0, dias: 0 })), false);
    assert.equal(entradaPreenchida(entrada('tabela_de_dados', { linhas: 10 })), true);
    assert.equal(entradaPreenchida(entrada('tabela_de_dados', { dias: 3 })), true);
  });

  it('seção e lista do contexto só contam com completude acima de zero', () => {
    assert.equal(entradaPreenchida(entrada('contexto_secao')), false);
    assert.equal(entradaPreenchida(entrada('contexto_secao', { completude: 40 })), true);
    assert.equal(entradaPreenchida(entrada('contexto_lista', { completude: 100 })), true);
  });

  it('capacidade é derivada do sistema e fica fora', () => {
    assert.equal(entradaPreenchida(entrada('capacidade', { completude: 100 })), false);
  });

  it('separa sem perder nem duplicar entrada', () => {
    const todas = [entrada('conexao'), entrada('tabela_de_dados'), entrada('contexto_secao', { completude: 10 }), entrada('capacidade')];
    const { preenchidas, vazias } = separarPorPreenchimento(todas);
    assert.equal(preenchidas.length + vazias.length, todas.length);
    assert.deepEqual(preenchidas.map((e) => e.tipo), ['conexao', 'contexto_secao']);
    assert.deepEqual(vazias.map((e) => e.tipo), ['tabela_de_dados', 'capacidade']);
  });
});
