import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { destinoDoErroDeAutorizacao, mensagemDoErroDeAutorizacao } from './erroDeAutorizacao.ts';

describe('erro de autorização', () => {
  it('volta para a página de origem com o erro e a plataforma, sem restos de resultado anterior', () => {
    assert.equal(
      destinoDoErroDeAutorizacao('/integracoes/conector/meta?aviso=x&autorizado=meta', 'estado_invalido', 'meta'),
      '/integracoes/conector/meta?erroConexao=estado_invalido&plataforma=meta',
    );
  });

  it('sem origem confiável, volta para as conexões e não para o onboarding', () => {
    assert.equal(destinoDoErroDeAutorizacao(null, 'estado_invalido', 'meta'), '/integracoes?erroConexao=estado_invalido&plataforma=meta');
  });

  it('preserva o passo do onboarding quando o fluxo começou nele', () => {
    assert.equal(
      destinoDoErroDeAutorizacao('/comecar?passo=contas', 'autorizacao_negada', 'google'),
      '/comecar?passo=contas&erroConexao=autorizacao_negada&plataforma=google',
    );
  });

  it('todo código tem mensagem, e código desconhecido cai numa mensagem genérica', () => {
    assert.match(mensagemDoErroDeAutorizacao('estado_invalido'), /outra aba/);
    assert.match(mensagemDoErroDeAutorizacao('qualquer'), /Tente de novo/);
  });
});
