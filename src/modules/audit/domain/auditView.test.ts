import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acoesPresentes,
  celulaDe,
  colunasDeMetadados,
  encurtarEscopo,
  familiaDe,
  indicadoresDaTrilha,
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

describe('indicadores da trilha', () => {
  const agora = new Date('2026-11-08T12:00:00Z');
  const em = (horasAtras: number, extra: Record<string, unknown>) => ({
    ...entrada('client.create'),
    id: `e-${horasAtras}-${JSON.stringify(extra)}`,
    occurredAt: new Date(agora.getTime() - horasAtras * 3600_000),
    ...extra,
  });

  it('conta só a janela, distingue atores e mede automação', () => {
    const resultado = indicadoresDaTrilha(
      [
        em(1, {}),
        em(2, { actorId: 'usuario-2' }),
        em(3, { actorType: 'worker', actorId: 'w-1' }),
        em(4, { actorType: 'system', actorId: null, action: 'plataforma.alerta' }),
        em(30, {}),
      ],
      agora,
    );

    assert.equal(resultado.eventos, 4);
    assert.equal(resultado.atoresDistintos, 3);
    assert.equal(resultado.automatizados, 2);
    assert.equal(resultado.percentualAutomatizado, 50);
    assert.equal(resultado.alertasEFalhas, 1);
    assert.equal(resultado.ultimoEvento?.getTime(), agora.getTime() - 3600_000);
    assert.equal(resultado.cobreJanelaInteira, true);
  });

  it('conta execução encerrada com status failed, não a bem-sucedida nem a parcial', () => {
    const resultado = indicadoresDaTrilha(
      [
        em(1, { action: 'coleta.execucao.fechar', metadata: { status: 'failed' } }),
        em(2, { action: 'sync.run.close', metadata: { status: 'failed' } }),
        em(3, { action: 'sync.run.close', metadata: { status: 'success' } }),
        em(4, { action: 'coleta.execucao.fechar', metadata: { status: 'partial' } }),
      ],
      agora,
    );
    assert.equal(resultado.alertasEFalhas, 2);
  });

  it('acesso por link público é pessoa, não automação', () => {
    const resultado = indicadoresDaTrilha(
      [em(1, { actorType: 'invite', actorId: null }), em(2, { actorType: 'agent', actorId: 'a-1' }), em(3, {})],
      agora,
    );
    assert.equal(resultado.automatizados, 1);
  });

  it('sem eventos não divide por zero', () => {
    const resultado = indicadoresDaTrilha([], agora);
    assert.equal(resultado.percentualAutomatizado, 0);
    assert.equal(resultado.ultimoEvento, null);
  });

  it('avisa quando a consulta bateu no limite', () => {
    const cheia = Array.from({ length: 3 }, (_, i) => em(i + 1, { id: `x${i}` }));
    assert.equal(indicadoresDaTrilha(cheia, agora, 24, 3).cobreJanelaInteira, false);
  });
});
