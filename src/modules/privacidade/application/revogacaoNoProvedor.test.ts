import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { ConexaoARevogar } from '../domain/revogacao.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createPoliticaDeRevogacao } = await import('./revogacaoNoProvedor.ts');
const { avisoDaRevogacao, mensagemDaRemocao, resultadoDaRevogacaoNoCofre } = await import('../domain/revogacao.ts');

function montar(opcoes: { compartilhado?: boolean | Error } = {}) {
  const consultas: string[] = [];
  const politica = createPoliticaDeRevogacao({
    async compartilhado(_organizationId, connectionId) {
      consultas.push(connectionId);
      if (opcoes.compartilhado instanceof Error) throw opcoes.compartilhado;
      return opcoes.compartilhado ?? false;
    },
  });
  return { politica, consultas };
}

const conexao = (sobrescrever: Partial<ConexaoARevogar> = {}): ConexaoARevogar => ({
  id: 'conn-1',
  organizationId: 'org-1',
  platform: 'youtube',
  grantType: 'oauth_user',
  ...sobrescrever,
});

describe('política de revogação no provedor ao remover a conexão', () => {
  it('Google e Meta com usuário OAuth: tenta revogar pelo cofre', async () => {
    for (const platform of ['ga4', 'youtube', 'meta', 'leadads'] as const) {
      assert.deepEqual(await montar().politica.decidir(conexao({ platform })), { tentar: true });
    }
  });

  it('chave de API e autorização sem usuário OAuth não são suportadas e nem consultam o compartilhamento', async () => {
    const { politica, consultas } = montar();
    assert.deepEqual(await politica.decidir(conexao({ platform: 'rdstation', grantType: 'api_key' })), {
      tentar: false,
      resultado: { revogadoNoProvedor: 'nao_suportado', motivo: 'plataforma_sem_revogacao' },
    });
    assert.deepEqual(await politica.decidir(conexao({ platform: 'meta', grantType: 'system_user' })), {
      tentar: false,
      resultado: { revogadoNoProvedor: 'nao_suportado', motivo: 'autorizacao_sem_usuario' },
    });
    assert.equal(consultas.length, 0);
  });

  it('não revoga quando a mesma pessoa autoriza outra conexão ativa', async () => {
    assert.deepEqual(await montar({ compartilhado: true }).politica.decidir(conexao()), {
      tentar: false,
      resultado: { revogadoNoProvedor: false, motivo: 'acesso_compartilhado' },
    });
  });

  it('falha ao conferir o compartilhamento não revoga (lado seguro)', async () => {
    assert.deepEqual(await montar({ compartilhado: new Error('banco') }).politica.decidir(conexao()), {
      tentar: false,
      resultado: { revogadoNoProvedor: false, motivo: 'falhou' },
    });
  });

  it('o desfecho do cofre vira o campo de auditoria revogadoNoProvedor', () => {
    assert.deepEqual(resultadoDaRevogacaoNoCofre('revogado'), { revogadoNoProvedor: true, motivo: 'revogado' });
    assert.deepEqual(resultadoDaRevogacaoNoCofre('falhou'), { revogadoNoProvedor: false, motivo: 'falhou' });
    assert.deepEqual(resultadoDaRevogacaoNoCofre('sem_token'), { revogadoNoProvedor: false, motivo: 'sem_credencial_no_cofre' });
    assert.deepEqual(resultadoDaRevogacaoNoCofre('sem_suporte'), { revogadoNoProvedor: 'nao_suportado', motivo: 'plataforma_sem_revogacao' });
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
      'Conexão removida. O token foi apagado do cofre e a coleta dessa conta parou. O acesso também foi revogado no provedor. Os dados do YouTube dessa conexão foram apagados do BigQuery.',
    );
    assert.match(
      mensagemDaRemocao({ revogadoNoProvedor: false, avisoDeRevogacao: 'AVISO', expurgo: { enfileirados: 1, concluidos: 0 } }),
      /parou\. AVISO Os dados do YouTube dessa conexão serão apagados do BigQuery em até 7 dias\.$/,
    );
  });
});
