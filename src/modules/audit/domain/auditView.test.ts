import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acoesPresentes,
  celulaDe,
  colunasDeMetadados,
  encurtarEscopo,
  familiaDe,
  resumoPorFamilia,
  rotuloDe,
} from './auditView.ts';

const entrada = (action: string, metadata: Record<string, unknown> = {}) => ({
  id: `id-${action}-${JSON.stringify(metadata).length}`,
  organizationId: 'org-1',
  occurredAt: new Date('2026-11-08T07:09:58Z'),
  actorType: 'user' as const,
  actorId: 'usuario-1',
  action,
  metadata,
});

describe('colunas a partir dos metadados', () => {
  it('reúne as chaves de eventos diferentes numa coluna cada', () => {
    const colunas = colunasDeMetadados([
      entrada('connection.authorize', { platform: 'google', discoveredAccounts: 0 }),
      entrada('client.create', { type: 'ecommerce' }),
    ]);

    assert.deepEqual(
      colunas.map((c) => c.chave),
      ['platform', 'discoveredAccounts', 'type'],
    );
  });

  it('coloca as chaves conhecidas antes das desconhecidas', () => {
    const colunas = colunasDeMetadados([
      entrada('x', { zzz: 1, platform: 'google', aaa: 2 }),
    ]);

    assert.equal(colunas[0]?.chave, 'platform');
    assert.deepEqual(colunas.slice(1).map((c) => c.chave), ['aaa', 'zzz']);
  });

  it('marca como numérica só a coluna numérica em todas as linhas', () => {
    const colunas = colunasDeMetadados([
      entrada('a', { contagem: 1, misto: 1 }),
      entrada('b', { contagem: 2, misto: 'texto' }),
    ]);

    assert.equal(colunas.find((c) => c.chave === 'contagem')?.numerica, true);
    assert.equal(colunas.find((c) => c.chave === 'misto')?.numerica, false);
  });

  it('não quebra com evento sem metadado', () => {
    assert.deepEqual(colunasDeMetadados([entrada('sozinho')]), []);
  });
});

describe('rótulos', () => {
  it('traduz as chaves que conhece', () => {
    assert.equal(rotuloDe('discoveredAccounts'), 'Contas descobertas');
    assert.equal(rotuloDe('vaultAvailable'), 'Cofre');
  });

  it('abre camelCase e snake_case nas que não conhece', () => {
    assert.equal(rotuloDe('algumCampoNovo'), 'Algum campo novo');
    assert.equal(rotuloDe('outro_campo'), 'Outro campo');
  });
});

describe('células', () => {
  it('distingue vazio de falso', () => {
    assert.equal(celulaDe(null).tipo, 'vazio');
    assert.equal(celulaDe(undefined).tipo, 'vazio');
    assert.equal(celulaDe('').tipo, 'vazio');
    assert.deepEqual(celulaDe(false), { tipo: 'booleano', verdadeiro: false });
  });

  it('transforma lista de escopos em fichas legíveis', () => {
    const celula = celulaDe([
      'https://www.googleapis.com/auth/adwords',
      'openid',
    ]);

    assert.deepEqual(celula, { tipo: 'lista', itens: ['adwords', 'openid'] });
  });

  it('trata lista vazia como vazio', () => {
    assert.equal(celulaDe([]).tipo, 'vazio');
  });

  it('serializa objeto aninhado em vez de sumir com ele', () => {
    assert.deepEqual(celulaDe({ a: 1 }), { tipo: 'texto', valor: '{"a":1}' });
  });

  it('preserva o número zero, que não é ausência', () => {
    assert.deepEqual(celulaDe(0), { tipo: 'texto', valor: '0' });
  });
});

describe('encurtar escopo', () => {
  it('mantém o último segmento da url', () => {
    assert.equal(encurtarEscopo('https://www.googleapis.com/auth/userinfo.email'), 'userinfo.email');
  });

  it('não mexe no que não é url', () => {
    assert.equal(encurtarEscopo('ads_read'), 'ads_read');
  });
});

describe('famílias de evento', () => {
  it('agrupa pelo prefixo antes do ponto', () => {
    assert.equal(familiaDe('connection.authorize'), 'connection');
    assert.equal(familiaDe('sem_ponto'), 'sem_ponto');
  });

  it('conta por família, da mais frequente para a menos', () => {
    const resumo = resumoPorFamilia([
      entrada('connection.authorize'),
      entrada('connection.create'),
      entrada('client.create'),
    ]);

    assert.deepEqual(resumo, [
      { familia: 'connection', total: 2 },
      { familia: 'client', total: 1 },
    ]);
  });

  it('lista os eventos distintos em ordem', () => {
    const acoes = acoesPresentes([
      entrada('connection.authorize'),
      entrada('client.create'),
      entrada('connection.authorize'),
    ]);

    assert.deepEqual(acoes, ['client.create', 'connection.authorize']);
  });
});
