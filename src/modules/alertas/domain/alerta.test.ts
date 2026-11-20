import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TAMANHO_MAXIMO_DA_MENSAGEM, assinaturaDoAlerta, limparAlerta } from './alerta.ts';

const base = { workflowId: 'wf1', workflowNome: 'ORLA · coleta · orquestrador', no: 'Fechar coleta', mensagem: 'falhou' };

describe('limpeza do alerta de falha', () => {
  it('remove token em URL, bearer e e-mail', () => {
    const limpo = limparAlerta({
      ...base,
      mensagem: 'GET https://x/y?access_token=EAAB123456789abc&a=1 Bearer abcdefghijklmnop contato maria.souza@exemplo.com.br',
    });
    for (const proibido of ['EAAB123456789abc', 'abcdefghijklmnop', 'maria.souza@']) assert.ok(!limpo.mensagem.includes(proibido), proibido);
    assert.match(limpo.mensagem, /m\*\*\*@exemplo\.com\.br/);
  });

  it('remove CPF e telefone', () => {
    const limpo = limparAlerta({ ...base, mensagem: 'lead 123.456.789-00 fone (11) 98888-7777' });
    assert.ok(!/123\.456\.789-00|98888-7777/.test(limpo.mensagem));
  });

  it('trunca a mensagem e o nome', () => {
    const limpo = limparAlerta({ ...base, workflowNome: 'n'.repeat(900), mensagem: 'x'.repeat(9000) });
    assert.equal(limpo.mensagem.length, TAMANHO_MAXIMO_DA_MENSAGEM);
    assert.equal(limpo.workflowNome.length, 200);
  });

  it('mensagem vazia vira texto fixo', () => {
    assert.equal(limparAlerta({ ...base, mensagem: '   ' }).mensagem, 'sem mensagem');
  });
});

describe('assinatura para deduplicar', () => {
  it('mesma falha com números diferentes tem a mesma assinatura', () => {
    assert.equal(assinaturaDoAlerta('A', 'execução 123456789012 falhou'), assinaturaDoAlerta('A', 'execução 998877665544 falhou'));
  });

  it('workflow diferente ou mensagem diferente muda a assinatura', () => {
    assert.notEqual(assinaturaDoAlerta('A', 'm'), assinaturaDoAlerta('B', 'm'));
    assert.notEqual(assinaturaDoAlerta('A', 'm1'), assinaturaDoAlerta('A', 'm2'));
  });

  it('é um sha-256 em hexadecimal', () => {
    assert.match(limparAlerta(base).assinatura, /^[0-9a-f]{64}$/);
  });
});
