import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { AdAccount } from '@/modules/connections/domain/adAccount';
import type { Connection, Platform } from '@/modules/connections/domain/connection';
import type { StoredDiscovery } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import type { NovaConexaoComId } from '@/modules/connections/infrastructure/connectionRepository';
import type { MemberRole } from '@/modules/identity/domain/user';
import type { NovoSegredo, RegistroDeToken } from '@/modules/tokens/application/portas';
import type { TipoDeSegredo } from '@/modules/tokens/domain/token';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createConnectionService } = await import('./connectionService.ts');
const { Platform: Plataformas } = await import('@/modules/connections/domain/connection.ts');
const { PLATAFORMAS_POR_CHAVE } = await import('@/modules/connections/domain/chaveDeApi.ts');
const { createCofreDeTokens } = await import('@/modules/tokens/application/cofreDeTokens.ts');
const { createCifraEnvelope } = await import('@/modules/tokens/infrastructure/envelope.ts');
const { createChaveMestraLocal } = await import('@/modules/tokens/infrastructure/chavesMestras.ts');
const { createPoliticaDeRevogacao } = await import('@/modules/privacidade/application/revogacaoNoProvedor.ts');

const ORGANIZACAO = 'org-1';
const ator = { userId: 'user-1', requestId: 'req-1', sourceIp: null };
const TODAS = Object.values(Plataformas) as Platform[];
const CHAVE = 'chave-de-api-com-mais-de-vinte-caracteres';

type Opcoes = {
  cofreFalha?: boolean;
  testeOk?: boolean;
  falhaNoInsert?: boolean;
  revogacaoNoProvedor?: 'revogado' | 'falhou';
  compartilhado?: boolean;
  expurgo?: { enfileirados: number; concluidos: number };
};

type TokenGuardado = { tipo: TipoDeSegredo; bytes: Buffer; versao: number; platform: Platform };

function montar(opcoes: Opcoes = {}) {
  const conexoes = new Map<string, Connection>();
  const tokens = new Map<string, TokenGuardado>();
  const eventos: AuditEvent[] = [];
  const substituicoesDeContas: { connectionId: string; quantidade: number }[] = [];
  const contasDaConexao = new Map<string, StoredDiscovery[]>();
  const avisos: string[] = [];
  const ordem: string[] = [];
  const revogadosNoProvedor: string[] = [];
  let sequencia = 0;

  const clientes = new Map([
    ['cli-credaz', { id: 'cli-credaz', name: 'Credaz' }],
    ['cli-outro', { id: 'cli-outro', name: 'Outro' }],
  ]);

  let corridaPendente: (() => void) | undefined;
  const dispararCorrida = (): void => {
    const acao = corridaPendente;
    corridaPendente = undefined;
    acao?.();
  };

  const comVersao = (conexao: Connection): Connection => ({ ...conexao, versaoDoToken: tokens.get(conexao.id)?.versao ?? null });
  const gravarToken = (id: string, platform: Platform, segredo: NovoSegredo) => {
    tokens.set(id, { tipo: segredo.tipo, bytes: segredo.cifrado.bytes, versao: (tokens.get(id)?.versao ?? 0) + 1, platform });
  };

  const repositorio = {
    async insert(input: NovaConexaoComId, segredo: NovoSegredo) {
      if (opcoes.falhaNoInsert) throw new Error('banco indisponível');
      const conexao: Connection = {
        ...input,
        status: input.status ?? 'active',
        authorizedAt: new Date(),
        webhookToken: input.webhookToken ?? null,
        versaoDoToken: null,
      };
      conexoes.set(conexao.id, conexao);
      gravarToken(conexao.id, conexao.platform, segredo);
      return comVersao(conexao);
    },
    async findById(_organizationId: string, id: string) {
      const lida = conexoes.get(id);
      return lida ? comVersao(lida) : null;
    },
    async findByExternalId(_organizationId: string, platform: string, externalId: string) {
      const lida = [...conexoes.values()].find((c) => c.platform === platform && c.externalId === externalId);
      const comToken = lida ? comVersao(lida) : null;
      dispararCorrida();
      return comToken;
    },
    async renew(input: NovaConexaoComId, segredo: NovoSegredo, esperada: number | null) {
      const atual = conexoes.get(input.id);
      if (!atual || (tokens.get(input.id)?.versao ?? null) !== esperada) return null;
      const renovada: Connection = { ...atual, ...input, status: input.status ?? 'active' };
      conexoes.set(renovada.id, renovada);
      gravarToken(renovada.id, renovada.platform, segredo);
      return comVersao(renovada);
    },
    async list() {
      return [...conexoes.values()].map(comVersao);
    },
    async revogar(_organizationId: string, id: string, esperada: number | null) {
      ordem.push('apagar');
      const atual = conexoes.get(id);
      if (!atual || atual.status === 'revoked' || (tokens.get(id)?.versao ?? null) !== esperada) return false;
      tokens.delete(id);
      conexoes.set(id, { ...atual, status: 'revoked', accountEmail: null, webhookToken: null });
      return true;
    },
  };

  const contasDescobertas = {
    async replace(_organizationId: string, connectionId: string, contas: readonly unknown[]) {
      substituicoesDeContas.push({ connectionId, quantidade: contas.length });
      return contas.length;
    },
    async liberarDaConexao(_organizationId: string, connectionId: string) {
      const alvo = (contasDaConexao.get(connectionId) ?? []).filter((c) => c.state === 'linked' && c.clientId);
      return alvo.map((c) => ({ ...c, state: 'discovered' as const, clientId: null, clientIdAnterior: c.clientId! }));
    },
  };

  const adAccounts = new Map<string, AdAccount>();
  const contas = {
    async insert(input: Omit<AdAccount, 'id' | 'status' | 'lastSyncAt'>) {
      const conta: AdAccount = { ...input, id: `ad-${++sequencia}`, status: 'linked', lastSyncAt: null };
      adAccounts.set(conta.id, conta);
      return conta;
    },
    async findByExternalId(_organizationId: string, platform: string, externalId: string) {
      return [...adAccounts.values()].find((c) => c.platform === platform && c.externalId === externalId) ?? null;
    },
    async findById(_organizationId: string, id: string) {
      return adAccounts.get(id) ?? null;
    },
    async reassign(_organizationId: string, id: string, clientId: string) {
      const conta = adAccounts.get(id);
      if (!conta) return null;
      const movida = { ...conta, clientId };
      adAccounts.set(id, movida);
      return movida;
    },
    async desvincular(_organizationId: string, id: string) {
      const conta = adAccounts.get(id);
      if (!conta) return null;
      const solta = { ...conta, status: 'unlinked' as const };
      adAccounts.set(id, solta);
      return solta;
    },
    async reativar(_organizationId: string, id: string, input: Omit<AdAccount, 'id' | 'status' | 'lastSyncAt'>) {
      const reativada: AdAccount = { ...adAccounts.get(id)!, ...input, status: 'linked' };
      adAccounts.set(id, reativada);
      return reativada;
    },
    async setSync() {
      return null;
    },
    async listByClient() {
      return [];
    },
    async listByOrganization() {
      return [];
    },
    async markSynced() {},
  };

  const cifra = createCifraEnvelope(createChaveMestraLocal('s'.repeat(40)));
  const registroDe = (connectionId: string): RegistroDeToken | null => {
    const token = tokens.get(connectionId);
    if (!token) return null;
    return {
      connectionId,
      organizationId: ORGANIZACAO,
      platform: token.platform,
      tipo: token.tipo,
      segredo: token.bytes,
      segredoExpiraEm: null,
      acesso: null,
      acessoExpiraEm: null,
      renovadoEm: null,
      versao: token.versao,
    };
  };
  const cofreReal = createCofreDeTokens({
    repositorio: {
      carregar: async (alvo: { connectionId: string }) => {
        const registro = registroDe(alvo.connectionId);
        dispararCorrida();
        return registro;
      },
      apagar: async () => {
        throw new Error('a remoção da conexão apaga o token pela transação do repositório de conexões');
      },
    } as never,
    cifra,
    provedores: (platform, tipo) =>
      tipo === 'api_key'
        ? { renovar: async () => ({ ok: false, error: { natureza: 'configuracao', codigo: 'x' } }), revogar: async () => ({ ok: true, value: 'sem_suporte' }) }
        : {
            renovar: async () => ({ ok: false, error: { natureza: 'configuracao', codigo: 'x' } }),
            revogar: async (segredo) => {
              ordem.push('revogar');
              revogadosNoProvedor.push(`${platform}:${segredo}`);
              return opcoes.revogacaoNoProvedor === 'falhou'
                ? { ok: false, error: { natureza: 'transitoria', codigo: 'http_503' } }
                : { ok: true, value: 'revogado' };
            },
          },
    marcador: { marcar: async () => {} },
    registro: { info() {}, aviso() {}, erro() {} },
  });
  const cofre = {
    selar: async (destino: { connectionId: string; platform: Platform }, novo: { tipo: TipoDeSegredo; segredo: string }) =>
      opcoes.cofreFalha ? { ok: false as const, error: 'indisponivel' as const } : cofreReal.selar(destino, novo),
    revogarEApagar: cofreReal.revogarEApagar,
    esquecer: cofreReal.esquecer,
  };
  const politica = createPoliticaDeRevogacao({ compartilhado: async () => opcoes.compartilhado ?? false });

  const servico = createConnectionService(
    repositorio as never,
    contas as never,
    {
      async record(evento: AuditEvent) {
        eventos.push(evento);
      },
    } as never,
    { findById: async (_organizationId: string, id: string) => clientes.get(id) ?? null },
    cofre,
    { testar: async () => (opcoes.testeOk === false ? { ok: false as const, error: { code: 'validation' as const, message: 'recusada' } } : { ok: true as const, value: undefined }) } as never,
    contasDescobertas as never,
    { posseMudou: (motivo: string) => void avisos.push(motivo) },
    {
      decidirRevogacao: (conexao) => politica.decidir(conexao),
      async expurgarDadosDaConexao(input: { connectionId: string; platform: string }) {
        ordem.push(`expurgar:${input.platform}:${conexoes.get(input.connectionId)?.status}`);
        return opcoes.expurgo ?? { enfileirados: 0, concluidos: 0 };
      },
    },
  );

  const armarCorrida = (acao: () => void): void => {
    corridaPendente = acao;
  };

  const decifrar = (id: string) => {
    const token = tokens.get(id)!;
    return cifra.decifrar(token.bytes, { connectionId: id, platform: token.platform, finalidade: 'segredo' });
  };

  return { armarCorrida, servico, conexoes, tokens, eventos, substituicoesDeContas, contasDaConexao, avisos, adAccounts, ordem, revogadosNoProvedor, cifra, decifrar, cofreReal };
}

const guardar = (c: ReturnType<typeof montar>, platform: Platform, papel: MemberRole = 'owner', chave = CHAVE) =>
  c.servico.guardarChave({ organizationId: ORGANIZACAO, organizationSlug: 'agencia', papelDeQuemAge: papel, platform, chave }, ator);

async function semearConexao(c: ReturnType<typeof montar>, platform: Platform, comToken = true) {
  const id = `semente-${platform}`;
  const porChave = (PLATAFORMAS_POR_CHAVE as readonly string[]).includes(platform);
  c.conexoes.set(id, {
    id,
    organizationId: ORGANIZACAO,
    platform,
    grantType: porChave ? 'api_key' : 'oauth_user',
    label: `Conexão ${platform}`,
    externalId: `id-${platform}`,
    accountEmail: 'dono@cliente.test',
    scopes: [],
    expiresAt: null,
    status: comToken ? 'active' : 'reauth_pending',
    authorizedAt: new Date(),
    webhookToken: null,
    authorizedVia: 'staff',
    versaoDoToken: null,
  });
  if (comToken) {
    const selado = await c.cofreReal.selar({ connectionId: id, platform }, { tipo: porChave ? 'api_key' : 'oauth_refresh', segredo: `segredo-de-${platform}` });
    assert.ok(selado.ok);
    c.tokens.set(id, { tipo: selado.value.tipo, bytes: selado.value.cifrado.bytes, versao: 1, platform });
  }
  return id;
}

function recurso(connectionId: string, platform: Platform, id: string, clientId: string | null): StoredDiscovery {
  return {
    id,
    connectionId,
    platform,
    externalId: `ext-${id}`,
    name: `Recurso ${id}`,
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    managerExternalId: null,
    inactive: false,
    spendingLast30Days: null,
    state: clientId ? 'linked' : 'discovered',
    clientId,
  } as StoredDiscovery;
}

const temRevogacaoNoProvedor = (platform: Platform) =>
  ['google', 'ga4', 'gtm', 'searchconsole', 'youtube', 'gbp', 'meta', 'pixel', 'leadads', 'whatsapp'].includes(platform);

describe('guardar chave de API: conectar e reconectar', () => {
  for (const plataforma of PLATAFORMAS_POR_CHAVE) {
    it(`${plataforma}: cifra a chave no cofre junto com a conexão, cria conta vinculável e audita, sem n8n`, async () => {
      const c = montar();
      const resultado = await guardar(c, plataforma);

      assert.ok(resultado.ok);
      const conexao = resultado.value;
      assert.equal(conexao.grantType, 'api_key');
      assert.equal(conexao.versaoDoToken, 1);
      assert.equal(c.tokens.get(conexao.id)!.tipo, 'api_key');
      assert.equal(await c.decifrar(conexao.id), CHAVE);
      assert.ok(!c.tokens.get(conexao.id)!.bytes.toString('latin1').includes(CHAVE));
      assert.ok(!JSON.stringify([...c.conexoes.values()]).includes(CHAVE), 'a chave apareceu fora do cofre');
      assert.deepEqual(c.substituicoesDeContas, [{ connectionId: conexao.id, quantidade: 1 }]);

      const [evento] = c.eventos;
      assert.equal(evento!.action, 'connection.key_stored');
      assert.equal(evento!.metadata?.rotacionou, false);
      assert.equal(evento!.metadata?.tipoNoCofre, 'api_key');
      assert.ok(!JSON.stringify(evento).includes(CHAVE));
    });

    it(`${plataforma}: rotacionar renova a mesma conexão e troca o token (versão nova)`, async () => {
      const c = montar();
      const primeira = await guardar(c, plataforma);
      const segunda = await guardar(c, plataforma, 'owner', `${CHAVE}-nova`);

      assert.ok(primeira.ok && segunda.ok);
      assert.equal(c.conexoes.size, 1);
      assert.equal(segunda.value.id, primeira.value.id);
      assert.equal(segunda.value.versaoDoToken, 2);
      assert.equal(await c.decifrar(segunda.value.id), `${CHAVE}-nova`);
      assert.equal(c.eventos[1]!.metadata?.rotacionou, true);
    });

    it(`${plataforma}: falha ao gravar a conexão não deixa token órfão`, async () => {
      const c = montar({ falhaNoInsert: true });
      await assert.rejects(guardar(c, plataforma), /banco indisponível/);

      assert.equal(c.tokens.size, 0);
      assert.equal(c.eventos.length, 0);
    });

    it(`${plataforma}: recusa papel sem permissão, chave curta, cofre fora do ar e chave recusada, sem gravar nada`, async () => {
      const casos: { c: ReturnType<typeof montar>; papel: MemberRole; chave: string; codigo: string }[] = [
        { c: montar(), papel: 'operator', chave: CHAVE, codigo: 'forbidden' },
        { c: montar(), papel: 'owner', chave: 'curta', codigo: 'validation' },
        { c: montar({ cofreFalha: true }), papel: 'owner', chave: CHAVE, codigo: 'unavailable' },
        { c: montar({ testeOk: false }), papel: 'owner', chave: CHAVE, codigo: 'validation' },
      ];

      for (const { c, papel, chave, codigo } of casos) {
        const resultado = await guardar(c, plataforma, papel, chave);
        assert.ok(!resultado.ok);
        assert.equal(resultado.error.code, codigo);
        assert.equal(c.conexoes.size, 0);
        assert.equal(c.tokens.size, 0);
        assert.equal(c.eventos.length, 0);
      }
    });
  }

  it('plataforma que se conecta por OAuth não aceita chave', async () => {
    const c = montar();
    const resultado = await guardar(c, 'ga4');
    assert.ok(!resultado.ok);
    assert.equal(c.conexoes.size, 0);
  });
});

describe('remover conexão (desconectar), por plataforma', () => {
  for (const plataforma of TODAS) {
    it(`${plataforma}: revoga no provedor quando dá, apaga o token, solta as contas vinculadas e audita`, async () => {
      const c = montar();
      const id = await semearConexao(c, plataforma);
      c.contasDaConexao.set(id, [
        recurso(id, plataforma, 'r1', 'cli-credaz'),
        recurso(id, plataforma, 'r2', 'cli-outro'),
        recurso(id, plataforma, 'r3', null),
      ]);

      const resultado = await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);

      assert.ok(resultado.ok);
      assert.equal(c.tokens.has(id), false, 'o ciphertext precisa sumir');
      const conexao = c.conexoes.get(id)!;
      assert.equal(conexao.status, 'revoked');
      assert.equal(conexao.accountEmail, null);
      assert.deepEqual(c.revogadosNoProvedor, temRevogacaoNoProvedor(plataforma) ? [`${plataforma}:segredo-de-${plataforma}`] : []);

      const desvinculos = c.eventos.filter((e) => e.action === 'connection_account.unlink');
      assert.deepEqual(
        desvinculos.map((e) => [e.targetId, e.metadata?.de, e.metadata?.motivo]),
        [['r1', 'Credaz', 'connection.removed'], ['r2', 'Outro', 'connection.removed']],
      );

      const removida = c.eventos.filter((e) => e.action === 'connection.removed');
      assert.equal(removida.length, 1);
      assert.equal(removida[0]!.targetId, id);
      assert.equal(removida[0]!.metadata?.platform, plataforma);
      assert.equal(removida[0]!.metadata?.contasLiberadas, 2);
      assert.equal(removida[0]!.metadata?.cofreApagado, true);
      assert.equal(removida[0]!.metadata?.revogadoNoProvedor, temRevogacaoNoProvedor(plataforma) ? true : 'nao_suportado');
      assert.deepEqual(c.avisos, ['connection_account.unlink']);
    });
  }

  it('revoga no provedor ANTES de apagar o ciphertext e expurga depois, registrando o resultado na trilha', async () => {
    const c = montar({ expurgo: { enfileirados: 1, concluidos: 1 } });
    const id = await semearConexao(c, 'youtube');

    const resultado = await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);

    assert.ok(resultado.ok);
    assert.deepEqual(c.ordem, ['revogar', 'apagar', 'expurgar:youtube:revoked']);
    assert.equal(resultado.value.revogadoNoProvedor, true);
    assert.equal(resultado.value.avisoDeRevogacao, null);
    const removida = c.eventos.find((e) => e.action === 'connection.removed')!;
    assert.equal(removida.metadata?.revogadoNoProvedor, true);
    assert.equal(removida.metadata?.motivoDaRevogacao, 'revogado');
    assert.deepEqual(removida.metadata?.expurgoDeFontes, { enfileirados: 1, concluidos: 1 });
  });

  it('revogação que falhou não impede apagar: o token some e o aviso traz o caminho manual', async () => {
    const google = montar({ revogacaoNoProvedor: 'falhou' });
    const idGoogle = await semearConexao(google, 'ga4');
    const noGoogle = await google.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: idGoogle }, ator);
    assert.ok(noGoogle.ok);
    assert.equal(google.tokens.has(idGoogle), false);
    assert.equal(google.conexoes.get(idGoogle)!.status, 'revoked');
    assert.equal(noGoogle.value.revogadoNoProvedor, false);
    assert.match(noGoogle.value.avisoDeRevogacao!, /myaccount\.google\.com\/permissions/);
    assert.equal(google.eventos.find((e) => e.action === 'connection.removed')!.metadata?.revogadoNoProvedor, false);
  });

  it('acesso compartilhado com outra conexão ativa: não chama o provedor, apaga o token e avisa', async () => {
    const meta = montar({ compartilhado: true });
    const idMeta = await semearConexao(meta, 'meta');
    const naMeta = await meta.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: idMeta }, ator);
    assert.ok(naMeta.ok);
    assert.deepEqual(meta.revogadosNoProvedor, []);
    assert.equal(meta.tokens.has(idMeta), false);
    assert.match(naMeta.value.avisoDeRevogacao!, /facebook\.com\/settings\?tab=business_tools/);
    assert.match(naMeta.value.avisoDeRevogacao!, /outra conexão ativa/);
  });

  it('conexão pós-corte sem token (reauth_pending): remove e avisa para revogar a autorização antiga à mão', async () => {
    const c = montar();
    const id = await semearConexao(c, 'gtm', false);
    const resultado = await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);
    assert.ok(resultado.ok);
    assert.equal(c.conexoes.get(id)!.status, 'revoked');
    assert.equal(resultado.value.revogadoNoProvedor, false);
    assert.match(resultado.value.avisoDeRevogacao!, /não havia token guardado no cofre/);
  });

  it('plataforma sem revogação (chave de API) registra nao_suportado e não mostra aviso', async () => {
    const c = montar();
    const id = await semearConexao(c, 'rdstation');
    const resultado = await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);
    assert.ok(resultado.ok);
    assert.equal(resultado.value.revogadoNoProvedor, 'nao_suportado');
    assert.equal(resultado.value.avisoDeRevogacao, null);
    assert.equal(c.eventos.find((e) => e.action === 'connection.removed')!.metadata?.revogadoNoProvedor, 'nao_suportado');
  });

  it('sem conta vinculada não avisa mudança de posse', async () => {
    const c = montar();
    const id = await semearConexao(c, 'ga4');
    await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);
    assert.deepEqual(c.avisos, []);
  });

  it('remover de novo, conexão inexistente e papel sem permissão são recusados sem efeito', async () => {
    const c = montar();
    const id = await semearConexao(c, 'ga4');
    const pedido = { organizationId: ORGANIZACAO, connectionId: id };

    const semPermissao = await c.servico.removerConexao({ ...pedido, papelDeQuemAge: 'operator' }, ator);
    assert.ok(!semPermissao.ok && semPermissao.error.code === 'forbidden');
    assert.equal(c.conexoes.get(id)!.status, 'active');
    assert.equal(c.tokens.has(id), true);

    assert.ok((await c.servico.removerConexao({ ...pedido, papelDeQuemAge: 'owner' }, ator)).ok);
    const eventosAntes = c.eventos.length;

    const repetida = await c.servico.removerConexao({ ...pedido, papelDeQuemAge: 'owner' }, ator);
    assert.ok(!repetida.ok && repetida.error.code === 'not_found');
    const inexistente = await c.servico.removerConexao({ ...pedido, connectionId: 'nao-existe', papelDeQuemAge: 'owner' }, ator);
    assert.ok(!inexistente.ok && inexistente.error.code === 'not_found');
    assert.equal(c.eventos.length, eventosAntes);
    assert.equal(c.revogadosNoProvedor.length, 1);
  });

  it('não mexe nas contas de anúncio (ADR 0011) nem em conexões de outras plataformas', async () => {
    const c = montar();
    const alvo = await semearConexao(c, 'google');
    const outra = await semearConexao(c, 'meta');
    const conta = await c.servico.linkAccount(
      {
        organizationId: ORGANIZACAO,
        clientId: 'cli-credaz',
        connectionId: alvo,
        platform: 'google',
        externalId: '123-456-7890',
        name: 'Conta',
        accountGroup: 'grupo',
        currency: 'BRL',
        timezone: 'America/Sao_Paulo',
        syncEnabled: true,
      },
      ator,
    );
    assert.ok(conta.ok);

    await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: alvo }, ator);

    assert.equal(c.adAccounts.get(conta.value.id)!.status, 'linked');
    assert.equal(c.conexoes.get(outra)!.status, 'active');
    assert.equal(c.tokens.has(outra), true);
  });
});

describe('conta de anúncio (google e meta): vincular, mover e desvincular', () => {
  const entradas = {
    google: { externalId: '123-456-7890' },
    meta: { externalId: 'act_1234567890' },
  } as const;

  for (const plataforma of ['google', 'meta'] as const) {
    it(`${plataforma}: vincula ao cliente, audita, avisa a posse e recusa segunda posse`, async () => {
      const c = montar();
      const conexao = await semearConexao(c, plataforma);
      const dados = {
        organizationId: ORGANIZACAO,
        clientId: 'cli-credaz',
        connectionId: conexao,
        platform: plataforma,
        externalId: entradas[plataforma].externalId,
        name: 'Conta',
        accountGroup: 'grupo',
        currency: 'BRL',
        timezone: 'America/Sao_Paulo',
        syncEnabled: true,
      };

      const vinculada = await c.servico.linkAccount(dados, ator);
      assert.ok(vinculada.ok);
      assert.equal(c.eventos.at(-1)!.action, 'ad_account.link');
      assert.equal(c.eventos.at(-1)!.metadata?.clientId, 'cli-credaz');

      const duplicada = await c.servico.linkAccount({ ...dados, clientId: 'cli-outro' }, ator);
      assert.ok(!duplicada.ok && duplicada.error.code === 'conflict');

      const movida = await c.servico.reassignAccount(
        { organizationId: ORGANIZACAO, papelDeQuemAge: 'operator', accountId: vinculada.value.id, clientId: 'cli-outro' },
        ator,
      );
      assert.ok(movida.ok);
      assert.equal(c.eventos.at(-1)!.action, 'ad_account.reassigned');
      assert.equal(c.eventos.at(-1)!.metadata?.de, 'Credaz');
      assert.equal(c.eventos.at(-1)!.metadata?.para, 'Outro');

      const solta = await c.servico.unlinkAccount(
        { organizationId: ORGANIZACAO, papelDeQuemAge: 'operator', accountId: vinculada.value.id },
        ator,
      );
      assert.ok(solta.ok);
      assert.equal(solta.value.status, 'unlinked');
      assert.equal(c.eventos.at(-1)!.action, 'ad_account.unlinked');
      assert.equal(c.eventos.at(-1)!.metadata?.de, 'Outro');

      const repetida = await c.servico.unlinkAccount(
        { organizationId: ORGANIZACAO, papelDeQuemAge: 'operator', accountId: vinculada.value.id },
        ator,
      );
      assert.ok(!repetida.ok && repetida.error.code === 'conflict');

      const revinculada = await c.servico.linkAccount({ ...dados, clientId: 'cli-outro' }, ator);
      assert.ok(revinculada.ok);
      assert.equal(c.eventos.at(-1)!.action, 'ad_account.relinked');

      assert.deepEqual(c.avisos, [
        'ad_account.link',
        'ad_account.reassigned',
        'ad_account.unlinked',
        'ad_account.relinked',
      ]);
    });

    it(`${plataforma}: não vincula em conexão revogada nem de outra plataforma`, async () => {
      const c = montar();
      const conexao = await semearConexao(c, plataforma);
      const outraPlataforma = plataforma === 'google' ? 'meta' : 'google';
      const base = {
        organizationId: ORGANIZACAO,
        clientId: 'cli-credaz',
        name: 'Conta',
        accountGroup: 'grupo',
        currency: 'BRL',
        timezone: 'America/Sao_Paulo',
        syncEnabled: true,
      };

      const cruzada = await c.servico.linkAccount(
        { ...base, connectionId: conexao, platform: outraPlataforma, externalId: entradas[outraPlataforma].externalId },
        ator,
      );
      assert.ok(!cruzada.ok && cruzada.error.code === 'validation');

      await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: conexao }, ator);
      const revogada = await c.servico.linkAccount(
        { ...base, connectionId: conexao, platform: plataforma, externalId: entradas[plataforma].externalId },
        ator,
      );
      assert.ok(!revogada.ok && revogada.error.code === 'conflict');
      assert.equal(c.adAccounts.size, 0);
    });
  }

  it('papel sem permissão não move nem desvincula', async () => {
    const c = montar();
    const mover = await c.servico.reassignAccount(
      { organizationId: ORGANIZACAO, papelDeQuemAge: 'viewer', accountId: 'x', clientId: 'cli-outro' },
      ator,
    );
    const soltar = await c.servico.unlinkAccount({ organizationId: ORGANIZACAO, papelDeQuemAge: 'viewer', accountId: 'x' }, ator);
    assert.ok(!mover.ok && mover.error.code === 'forbidden');
    assert.ok(!soltar.ok && soltar.error.code === 'forbidden');
    assert.equal(c.eventos.length, 0);
  });
});

describe('concorrência: a versão do token substitui a trava de credential_ref (PR #107)', () => {
  const pedido = (id: string) => ({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner' as const, connectionId: id });

  it('renovação concorrente da chave: quem leu a versão velha recebe conflito e o token vencedor fica', async () => {
    const c = montar();
    const primeira = await guardar(c, 'apify');
    assert.ok(primeira.ok);
    c.armarCorrida(() => {
      const atual = c.tokens.get(primeira.value.id)!;
      c.tokens.set(primeira.value.id, { ...atual, versao: atual.versao + 1 });
    });

    const segunda = await guardar(c, 'apify', 'owner', `${CHAVE}-nova`);

    assert.ok(!segunda.ok);
    assert.equal(segunda.error.code, 'conflict');
    assert.equal(await c.decifrar(primeira.value.id), CHAVE, 'o token mais novo gravado não é sobrescrito pelo atrasado');
    assert.equal(c.tokens.get(primeira.value.id)!.versao, 2);
    assert.equal(c.eventos.length, 1);
  });

  it('remoção concorrente com renovação: não apaga o token vencedor, não muda o status e pede nova tentativa', async () => {
    const c = montar({ revogacaoNoProvedor: 'revogado' });
    const id = await semearConexao(c, 'apify');
    c.armarCorrida(() => {
      const atual = c.tokens.get(id)!;
      c.tokens.set(id, { ...atual, versao: atual.versao + 1 });
    });

    const resultado = await c.servico.removerConexao(pedido(id), ator);

    assert.ok(!resultado.ok);
    assert.equal(resultado.error.code, 'conflict');
    assert.equal(c.conexoes.get(id)!.status, 'active');
    assert.equal(c.tokens.has(id), true);
    assert.equal(c.eventos.length, 0);
  });

  it('revogou no provedor mas a conexão mudou antes de apagar: conflito que diz que o acesso já caiu e deixa rastro', async () => {
    const c = montar();
    const id = await semearConexao(c, 'meta');
    c.armarCorrida(() => {
      const atual = c.tokens.get(id)!;
      c.tokens.set(id, { ...atual, versao: atual.versao + 1 });
    });

    const resultado = await c.servico.removerConexao(pedido(id), ator);

    assert.ok(!resultado.ok);
    assert.match(resultado.error.message, /já foi revogado no provedor/);
    assert.equal(c.conexoes.get(id)!.status, 'active');
    assert.deepEqual(c.ordem, ['revogar', 'apagar']);
    assert.deepEqual(c.eventos.map((e) => e.action), ['connection.provider_revoked']);
  });

  it('remove conexão degradada sem token mesmo com o provedor fora do ar', async () => {
    const c = montar({ revogacaoNoProvedor: 'falhou' });
    const id = await semearConexao(c, 'ga4', false);
    c.conexoes.set(id, { ...c.conexoes.get(id)!, status: 'degraded' });
    const resultado = await c.servico.removerConexao(pedido(id), ator);
    assert.ok(resultado.ok);
    assert.equal(c.conexoes.get(id)!.status, 'revoked');
  });
});
