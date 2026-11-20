import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { ExecutorDeRevogacao, DesfechoDoExecutor } from './revogacaoNoProvedor.ts';
import type { ConexaoARevogar } from '../domain/revogacao.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createRevogadorNoProvedor } = await import('./revogacaoNoProvedor.ts');
const { avisoDaRevogacao, mensagemDaRemocao } = await import('../domain/revogacao.ts');

function montar(opcoes: { desfecho?: DesfechoDoExecutor | Error; compartilhado?: boolean | Error; disponivel?: boolean } = {}) {
  const pedidos: { provedor: string; credentialId: string }[] = [];
  const executor: ExecutorDeRevogacao = {
    disponivel: opcoes.disponivel ?? true,
    async executar(input) {
      pedidos.push({ provedor: input.provedor, credentialId: input.credentialId });
      if (opcoes.desfecho instanceof Error) throw opcoes.desfecho;
      return opcoes.desfecho ?? 'revogado';
    },
  };
  const revogador = createRevogadorNoProvedor(executor, {
    async compartilhado() {
      if (opcoes.compartilhado instanceof Error) throw opcoes.compartilhado;
      return opcoes.compartilhado ?? false;
    },
  });
  return { revogador, pedidos };
}

const conexao = (sobrescrever: Partial<ConexaoARevogar> = {}): ConexaoARevogar => ({
  id: 'conn-1',
  organizationId: 'org-1',
  platform: 'youtube',
  grantType: 'oauth_user',
  credentialRef: 'n8n:credential:abc123XYZ',
  ...sobrescrever,
});

describe('revogação no provedor ao remover a conexão', () => {
  it('Google e Meta revogam com a credencial da própria conexão', async () => {
    for (const [platform, provedor] of [['ga4', 'google'], ['youtube', 'google'], ['meta', 'meta'], ['leadads', 'meta']] as const) {
      const { revogador, pedidos } = montar();
      assert.deepEqual(await revogador.revogar(conexao({ platform })), { revogadoNoProvedor: true, motivo: 'revogado' });
      assert.deepEqual(pedidos, [{ provedor, credentialId: 'abc123XYZ' }]);
    }
  });

  it('chave de API e autorização sem usuário OAuth não são suportadas e não chamam o executor', async () => {
    const { revogador, pedidos } = montar();
    assert.equal((await revogador.revogar(conexao({ platform: 'rdstation', grantType: 'api_key' }))).revogadoNoProvedor, 'nao_suportado');
    assert.deepEqual(await revogador.revogar(conexao({ platform: 'meta', grantType: 'system_user' })), {
      revogadoNoProvedor: 'nao_suportado',
      motivo: 'autorizacao_sem_usuario',
    });
    assert.equal(pedidos.length, 0);
  });

  it('não revoga quando a mesma pessoa autoriza outra conexão ativa', async () => {
    const { revogador, pedidos } = montar({ compartilhado: true });
    assert.deepEqual(await revogador.revogar(conexao()), { revogadoNoProvedor: false, motivo: 'acesso_compartilhado' });
    assert.equal(pedidos.length, 0);
  });

  it('falha ao conferir o compartilhamento não revoga (lado seguro)', async () => {
    const { revogador, pedidos } = montar({ compartilhado: new Error('banco') });
    assert.deepEqual(await revogador.revogar(conexao()), { revogadoNoProvedor: false, motivo: 'falhou' });
    assert.equal(pedidos.length, 0);
  });

  it('sem credencial no cofre, sem n8n, recusa ou erro do provedor viram false', async () => {
    assert.equal((await montar().revogador.revogar(conexao({ credentialRef: 'pendente:cofre-indisponivel' }))).motivo, 'sem_credencial_no_cofre');
    assert.equal((await montar({ disponivel: false }).revogador.revogar(conexao())).motivo, 'revogador_indisponivel');
    assert.deepEqual(await montar({ desfecho: 'recusado' }).revogador.revogar(conexao()), { revogadoNoProvedor: false, motivo: 'recusado_pelo_provedor' });
    assert.deepEqual(await montar({ desfecho: new Error('timeout') }).revogador.revogar(conexao()), { revogadoNoProvedor: false, motivo: 'falhou' });
  });
});

describe('aviso ao admin', () => {
  it('só aparece quando não revogou num provedor conhecido, com a instrução exata', () => {
    assert.equal(avisoDaRevogacao('ga4', { revogadoNoProvedor: true, motivo: 'revogado' }), null);
    assert.equal(avisoDaRevogacao('rdstation', { revogadoNoProvedor: 'nao_suportado', motivo: 'plataforma_sem_revogacao' }), null);
    assert.match(avisoDaRevogacao('youtube', { revogadoNoProvedor: false, motivo: 'falhou' })!, /myaccount\.google\.com\/permissions/);
    assert.match(avisoDaRevogacao('pixel', { revogadoNoProvedor: false, motivo: 'falhou' })!, /facebook\.com\/settings\?tab=business_tools/);
  });

  it('a mensagem da remoção soma revogação, aviso e expurgo do YouTube', () => {
    assert.equal(
      mensagemDaRemocao({ revogadoNoProvedor: true, avisoDeRevogacao: null, expurgo: { enfileirados: 1, concluidos: 1 } }),
      'Conexão removida. A credencial foi apagada do cofre e a coleta dessa conta parou. O acesso também foi revogado no provedor. Os dados do YouTube dessa conexão foram apagados do BigQuery.',
    );
    assert.match(
      mensagemDaRemocao({ revogadoNoProvedor: false, avisoDeRevogacao: 'AVISO', expurgo: { enfileirados: 1, concluidos: 0 } }),
      /parou\. AVISO Os dados do YouTube dessa conexão serão apagados do BigQuery em até 7 dias\.$/,
    );
  });
});
