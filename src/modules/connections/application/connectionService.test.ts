import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { AdAccount } from '@/modules/connections/domain/adAccount';
import type { Connection, NewConnection, Platform } from '@/modules/connections/domain/connection';
import type { StoredDiscovery } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import type { DiscardOutcome } from '@/modules/connections/application/credentialVault';
import type { MemberRole } from '@/modules/identity/domain/user';

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

const ORGANIZACAO = 'org-1';
const ator = { userId: 'user-1', requestId: 'req-1', sourceIp: null };
const TODAS = Object.values(Plataformas) as Platform[];
const CHAVE = 'chave-de-api-com-mais-de-vinte-caracteres';

type Opcoes = {
  descarte?: DiscardOutcome;
  cofre?: boolean;
  testeOk?: boolean;
  falhaNoInsert?: boolean;
  removerWorkflow?: boolean;
  revogacao?: { revogadoNoProvedor: true | false | 'nao_suportado'; motivo: string };
  expurgo?: { enfileirados: number; concluidos: number };
};

function montar(opcoes: Opcoes = {}) {
  const conexoes = new Map<string, Connection>();
  const refs = new Map<string, { coletor: string | null; executor: string | null }>();
  const eventos: AuditEvent[] = [];
  const descartados: string[] = [];
  const coletores = { criados: [] as string[], removidos: [] as string[] };
  const substituicoesDeContas: { connectionId: string; quantidade: number }[] = [];
  const contasDaConexao = new Map<string, StoredDiscovery[]>();
  const avisos: string[] = [];
  const ordem: string[] = [];
  let sequencia = 0;

  const clientes = new Map([
    ['cli-credaz', { id: 'cli-credaz', name: 'Credaz' }],
    ['cli-outro', { id: 'cli-outro', name: 'Outro' }],
  ]);

  let corridaPendente: ((conexoes: Map<string, Connection>) => void) | undefined;
  const dispararCorrida = (): void => {
    const acao = corridaPendente;
    corridaPendente = undefined;
    acao?.(conexoes);
  };

  const repositorio = {
    async insert(input: NewConnection) {
      if (opcoes.falhaNoInsert) throw new Error('banco indisponível');
      const conexao: Connection = {
        ...input,
        id: `conn-${++sequencia}`,
        status: input.status ?? 'active',
        authorizedAt: new Date(),
        webhookToken: input.webhookToken ?? null,
      };
      conexoes.set(conexao.id, conexao);
      refs.set(conexao.id, { coletor: null, executor: null });
      return conexao;
    },
    async findById(_organizationId: string, id: string) {
      const lida = conexoes.get(id) ?? null;
      dispararCorrida();
      return lida;
    },
    async findByExternalId(_organizationId: string, platform: string, externalId: string) {
      const lida = [...conexoes.values()].find((c) => c.platform === platform && c.externalId === externalId) ?? null;
      dispararCorrida();
      return lida;
    },
    async renew(input: NewConnection & { id: string }, esperada: string) {
      const atual = conexoes.get(input.id)!;
      if (atual.credentialRef !== esperada) return null;
      const renovada: Connection = { ...atual, ...input, status: input.status ?? 'active' };
      conexoes.set(renovada.id, renovada);
      return renovada;
    },
    async list() {
      return [...conexoes.values()];
    },
    async revogar(_organizationId: string, id: string, esperada: string) {
      const atual = conexoes.get(id);
      if (!atual || atual.status === 'revoked' || atual.credentialRef !== esperada) return null;
      conexoes.set(id, { ...atual, status: 'revoked', credentialRef: 'descartada', accountEmail: null });
      const anteriores = refs.get(id)!;
      refs.set(id, { coletor: null, executor: null });
      return { coletorRef: anteriores.coletor, executorRef: anteriores.executor };
    },
    async trocarColetorRef(_organizationId: string, id: string, ref: string) {
      const atuais = refs.get(id)!;
      const anterior = atuais.coletor;
      atuais.coletor = ref;
      return anterior;
    },
    async trocarExecutorRef() {
      return null;
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

  const servico = createConnectionService(
    repositorio as never,
    contas as never,
    {
      async record(evento: AuditEvent) {
        eventos.push(evento);
      },
    } as never,
    { findById: async (_organizationId: string, id: string) => clientes.get(id) ?? null },
    {
      available: opcoes.cofre ?? true,
      async store() {
        return `n8n:credential:cred${descartados.length + conexoes.size + sequencia}xyz`;
      },
      async discard(ref: string) {
        ordem.push('descartar');
        const resultado = opcoes.descarte ?? 'descartada';
        if (resultado === 'descartada') descartados.push(ref);
        return resultado;
      },
    },
    { testar: async () => (opcoes.testeOk === false ? { ok: false as const, error: { code: 'validation' as const, message: 'recusada' } } : { ok: true as const, value: undefined }) } as never,
    {
      async provisionar() {
        const ref = `wf-coletor-${coletores.criados.length + 1}`;
        coletores.criados.push(ref);
        return ref;
      },
      async remover(ref: string) {
        coletores.removidos.push(ref);
        return opcoes.removerWorkflow ?? true;
      },
    },
    contasDescobertas as never,
    { posseMudou: (motivo: string) => void avisos.push(motivo) },
    {
      async revogarNoProvedor(conexao: { id: string }) {
        ordem.push(`revogar:${conexao.id}`);
        return (opcoes.revogacao ?? { revogadoNoProvedor: 'nao_suportado', motivo: 'plataforma_sem_revogacao' }) as never;
      },
      async expurgarDadosDaConexao(input: { connectionId: string; platform: string }) {
        ordem.push(`expurgar:${input.platform}:${conexoes.get(input.connectionId)?.status}`);
        return opcoes.expurgo ?? { enfileirados: 0, concluidos: 0 };
      },
    },
  );

  const armarCorrida = (acao: (conexoes: Map<string, Connection>) => void): void => {
    corridaPendente = acao;
  };

  return { armarCorrida, servico, conexoes, refs, eventos, descartados, coletores, substituicoesDeContas, contasDaConexao, avisos, adAccounts, ordem };
}

const guardar = (c: ReturnType<typeof montar>, platform: Platform, papel: MemberRole = 'owner', chave = CHAVE) =>
  c.servico.guardarChave({ organizationId: ORGANIZACAO, organizationSlug: 'agencia', papelDeQuemAge: papel, platform, chave }, ator);

const conexaoNova = (platform: Platform): NewConnection => ({
  organizationId: ORGANIZACAO,
  platform,
  grantType: 'oauth_user',
  label: `Conexão ${platform}`,
  externalId: `id-${platform}`,
  accountEmail: 'dono@cliente.test',
  scopes: [],
  credentialRef: `n8n:credential:ref${platform}123`,
  expiresAt: null,
  authorizedVia: 'staff',
});

function semearConexao(c: ReturnType<typeof montar>, platform: Platform, comWorkflows = true) {
  const id = `semente-${platform}`;
  c.conexoes.set(id, { ...conexaoNova(platform), id, status: 'active', authorizedAt: new Date(), webhookToken: null });
  c.refs.set(id, comWorkflows ? { coletor: `wf-coletor-${platform}`, executor: `wf-executor-${platform}` } : { coletor: null, executor: null });
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

describe('guardar chave de API: conectar e reconectar', () => {
  for (const plataforma of PLATAFORMAS_POR_CHAVE) {
    it(`${plataforma}: guarda no cofre, cria conta vinculável, provisiona o coletor uma vez e audita`, async () => {
      const c = montar();
      const resultado = await guardar(c, plataforma);

      assert.ok(resultado.ok);
      const conexao = resultado.value;
      assert.equal(conexao.grantType, 'api_key');
      assert.match(conexao.credentialRef, /^n8n:credential:/);
      assert.ok(!JSON.stringify([...c.conexoes.values()]).includes(CHAVE), 'a chave apareceu fora do cofre');
      assert.deepEqual(c.substituicoesDeContas, [{ connectionId: conexao.id, quantidade: 1 }]);
      assert.equal(c.coletores.criados.length, 1);
      assert.equal(c.refs.get(conexao.id)!.coletor, 'wf-coletor-1');

      const [evento] = c.eventos;
      assert.equal(evento!.action, 'connection.key_stored');
      assert.equal(evento!.metadata?.rotacionou, false);
      assert.equal(evento!.metadata?.coletorProvisionado, true);
      assert.ok(!JSON.stringify(evento).includes(CHAVE));
    });

    it(`${plataforma}: rotacionar renova a mesma conexão, descarta a chave antiga e troca o coletor`, async () => {
      const c = montar();
      const primeira = await guardar(c, plataforma);
      const segunda = await guardar(c, plataforma, 'owner', `${CHAVE}-nova`);

      assert.ok(primeira.ok && segunda.ok);
      assert.equal(c.conexoes.size, 1);
      assert.equal(segunda.value.id, primeira.value.id);
      assert.notEqual(segunda.value.credentialRef, primeira.value.credentialRef);
      assert.deepEqual(c.descartados, [primeira.value.credentialRef]);
      assert.deepEqual(c.coletores.removidos, ['wf-coletor-1']);
      assert.equal(c.refs.get(segunda.value.id)!.coletor, 'wf-coletor-2');
      assert.equal(c.eventos[1]!.metadata?.rotacionou, true);
    });

    it(`${plataforma}: falha ao gravar a conexão descarta a chave recém-guardada`, async () => {
      const c = montar({ falhaNoInsert: true });
      await assert.rejects(guardar(c, plataforma), /banco indisponível/);

      assert.equal(c.descartados.length, 1);
      assert.equal(c.coletores.criados.length, 0);
      assert.equal(c.eventos.length, 0);
    });

    it(`${plataforma}: recusa papel sem permissão, chave curta, cofre fora do ar e chave recusada, sem gravar nada`, async () => {
      const casos: { c: ReturnType<typeof montar>; papel: MemberRole; chave: string; codigo: string }[] = [
        { c: montar(), papel: 'operator', chave: CHAVE, codigo: 'forbidden' },
        { c: montar(), papel: 'owner', chave: 'curta', codigo: 'validation' },
        { c: montar({ cofre: false }), papel: 'owner', chave: CHAVE, codigo: 'unavailable' },
        { c: montar({ testeOk: false }), papel: 'owner', chave: CHAVE, codigo: 'validation' },
      ];

      for (const { c, papel, chave, codigo } of casos) {
        const resultado = await guardar(c, plataforma, papel, chave);
        assert.ok(!resultado.ok);
        assert.equal(resultado.error.code, codigo);
        assert.equal(c.conexoes.size, 0);
        assert.equal(c.coletores.criados.length, 0);
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
    it(`${plataforma}: descarta a credencial, revoga, remove coletor e executor, solta as contas vinculadas e audita`, async () => {
      const c = montar();
      const id = semearConexao(c, plataforma);
      const credencial = c.conexoes.get(id)!.credentialRef;
      c.contasDaConexao.set(id, [
        recurso(id, plataforma, 'r1', 'cli-credaz'),
        recurso(id, plataforma, 'r2', 'cli-outro'),
        recurso(id, plataforma, 'r3', null),
      ]);

      const resultado = await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);

      assert.ok(resultado.ok);
      assert.deepEqual(c.descartados, [credencial]);
      const conexao = c.conexoes.get(id)!;
      assert.equal(conexao.status, 'revoked');
      assert.equal(conexao.credentialRef, 'descartada');
      assert.deepEqual(c.coletores.removidos, [`wf-coletor-${plataforma}`, `wf-executor-${plataforma}`]);

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
      assert.deepEqual(c.avisos, ['connection_account.unlink']);
    });

    it(`${plataforma}: falha do cofre não altera nada`, async () => {
      for (const descarte of ['falhou', 'sem_permissao'] as const) {
        const c = montar({ descarte });
        const id = semearConexao(c, plataforma);
        c.contasDaConexao.set(id, [recurso(id, plataforma, 'r1', 'cli-credaz')]);

        const resultado = await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);

        assert.ok(!resultado.ok);
        assert.equal(resultado.error.code, 'conflict');
        assert.equal(c.conexoes.get(id)!.status, 'active');
        assert.deepEqual(c.refs.get(id), { coletor: `wf-coletor-${plataforma}`, executor: `wf-executor-${plataforma}` });
        assert.equal(c.coletores.removidos.length, 0);
        assert.equal(c.eventos.length, 0);
        assert.equal(c.avisos.length, 0);
      }
    });
  }

  it('revoga no provedor antes de apagar do cofre e expurga depois de revogar, registrando o resultado na trilha', async () => {
    const c = montar({ revogacao: { revogadoNoProvedor: true, motivo: 'revogado' }, expurgo: { enfileirados: 1, concluidos: 1 } });
    const id = semearConexao(c, 'youtube');

    const resultado = await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);

    assert.ok(resultado.ok);
    assert.deepEqual(c.ordem, [`revogar:${id}`, 'descartar', 'expurgar:youtube:revoked']);
    assert.equal(resultado.value.revogadoNoProvedor, true);
    assert.equal(resultado.value.avisoDeRevogacao, null);
    const removida = c.eventos.find((e) => e.action === 'connection.removed')!;
    assert.equal(removida.metadata?.revogadoNoProvedor, true);
    assert.equal(removida.metadata?.motivoDaRevogacao, 'revogado');
    assert.deepEqual(removida.metadata?.expurgoDeFontes, { enfileirados: 1, concluidos: 1 });
  });

  it('revogação que falhou não impede remover, mas devolve o aviso com o caminho de revogar no provedor', async () => {
    const google = montar({ revogacao: { revogadoNoProvedor: false, motivo: 'falhou' } });
    const idGoogle = semearConexao(google, 'ga4');
    const noGoogle = await google.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: idGoogle }, ator);
    assert.ok(noGoogle.ok);
    assert.equal(google.conexoes.get(idGoogle)!.status, 'revoked');
    assert.equal(noGoogle.value.revogadoNoProvedor, false);
    assert.match(noGoogle.value.avisoDeRevogacao!, /myaccount\.google\.com\/permissions/);
    assert.equal(google.eventos.find((e) => e.action === 'connection.removed')!.metadata?.revogadoNoProvedor, false);

    const meta = montar({ revogacao: { revogadoNoProvedor: false, motivo: 'acesso_compartilhado' } });
    const idMeta = semearConexao(meta, 'meta');
    const naMeta = await meta.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: idMeta }, ator);
    assert.ok(naMeta.ok);
    assert.match(naMeta.value.avisoDeRevogacao!, /facebook\.com\/settings\?tab=business_tools/);
    assert.match(naMeta.value.avisoDeRevogacao!, /outra conexão ativa/);
  });

  it('plataforma sem revogação (chave de API) registra nao_suportado e não mostra aviso', async () => {
    const c = montar();
    const id = semearConexao(c, 'rdstation');
    const resultado = await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);
    assert.ok(resultado.ok);
    assert.equal(resultado.value.revogadoNoProvedor, 'nao_suportado');
    assert.equal(resultado.value.avisoDeRevogacao, null);
    assert.equal(c.eventos.find((e) => e.action === 'connection.removed')!.metadata?.revogadoNoProvedor, 'nao_suportado');
  });

  it('cofre que falha depois de revogar no provedor não altera a conexão, diz que o acesso já caiu e deixa rastro', async () => {
    const c = montar({ descarte: 'falhou', revogacao: { revogadoNoProvedor: true, motivo: 'revogado' } });
    const id = semearConexao(c, 'meta');
    const resultado = await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);
    assert.ok(!resultado.ok);
    assert.match(resultado.error.message, /já foi revogado no provedor/);
    assert.equal(c.conexoes.get(id)!.status, 'active');
    assert.deepEqual(c.ordem, [`revogar:${id}`, 'descartar']);
    assert.deepEqual(c.eventos.map((e) => e.action), ['connection.provider_revoked']);
  });

  it('sem workflows provisionados não tenta remover nada', async () => {
    const c = montar();
    const id = semearConexao(c, 'ga4', false);
    const resultado = await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'admin', connectionId: id }, ator);
    assert.ok(resultado.ok);
    assert.equal(c.coletores.removidos.length, 0);
  });

  it('sem conta vinculada não avisa mudança de posse', async () => {
    const c = montar();
    const id = semearConexao(c, 'ga4');
    await c.servico.removerConexao({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner', connectionId: id }, ator);
    assert.deepEqual(c.avisos, []);
  });

  it('remover de novo, conexão inexistente e papel sem permissão são recusados sem efeito', async () => {
    const c = montar();
    const id = semearConexao(c, 'ga4');
    const pedido = { organizationId: ORGANIZACAO, connectionId: id };

    const semPermissao = await c.servico.removerConexao({ ...pedido, papelDeQuemAge: 'operator' }, ator);
    assert.ok(!semPermissao.ok && semPermissao.error.code === 'forbidden');
    assert.equal(c.conexoes.get(id)!.status, 'active');

    assert.ok((await c.servico.removerConexao({ ...pedido, papelDeQuemAge: 'owner' }, ator)).ok);
    const eventosAntes = c.eventos.length;

    const repetida = await c.servico.removerConexao({ ...pedido, papelDeQuemAge: 'owner' }, ator);
    assert.ok(!repetida.ok && repetida.error.code === 'not_found');
    const inexistente = await c.servico.removerConexao({ ...pedido, connectionId: 'nao-existe', papelDeQuemAge: 'owner' }, ator);
    assert.ok(!inexistente.ok && inexistente.error.code === 'not_found');
    assert.equal(c.eventos.length, eventosAntes);
    assert.equal(c.descartados.length, 1);
  });

  it('não mexe nas contas de anúncio (ADR 0011) nem em conexões de outras plataformas', async () => {
    const c = montar();
    const alvo = semearConexao(c, 'google');
    const outra = semearConexao(c, 'meta');
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
    assert.deepEqual(c.refs.get(outra), { coletor: 'wf-coletor-meta', executor: 'wf-executor-meta' });
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
      const conexao = semearConexao(c, plataforma);
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
      const conexao = semearConexao(c, plataforma);
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

describe('conexão degradada, concorrência e coletor órfão (ADR 0024)', () => {
  const pedido = (id: string) => ({ organizationId: ORGANIZACAO, papelDeQuemAge: 'owner' as const, connectionId: id });

  for (const referencia of ['pendente:cofre-indisponivel', 'descartada']) {
    it(`remove conexão com referência "${referencia}" sem consultar o cofre, mesmo com o cofre falhando`, async () => {
      const c = montar({ descarte: 'falhou' });
      const id = semearConexao(c, 'ga4');
      c.conexoes.set(id, { ...c.conexoes.get(id)!, credentialRef: referencia, status: 'degraded' });

      const resultado = await c.servico.removerConexao(pedido(id), ator);

      assert.ok(resultado.ok);
      assert.equal(c.conexoes.get(id)!.status, 'revoked');
      assert.deepEqual(c.descartados, []);
    });
  }

  const trocarRefPorOutraRequisicao = (conexoes: Map<string, Connection>): void => {
    const atual = [...conexoes.values()][0]!;
    conexoes.set(atual.id, { ...atual, credentialRef: 'n8n:credential:vencedora999' });
  };

  it('renovação concorrente da chave: descarta a credencial nova, mantém a vencedora e não cria coletor', async () => {
    const c = montar();
    const primeira = await guardar(c, 'apify');
    assert.ok(primeira.ok);
    const coletoresAntes = c.coletores.criados.length;
    c.armarCorrida(trocarRefPorOutraRequisicao);

    const segunda = await guardar(c, 'apify', 'owner', `${CHAVE}-nova`);

    assert.ok(!segunda.ok);
    assert.equal(segunda.error.code, 'conflict');
    assert.equal(c.conexoes.get(primeira.value.id)!.credentialRef, 'n8n:credential:vencedora999');
    assert.equal(c.descartados.length, 1);
    assert.notEqual(c.descartados[0], primeira.value.credentialRef);
    assert.notEqual(c.descartados[0], 'n8n:credential:vencedora999');
    assert.equal(c.coletores.criados.length, coletoresAntes);
    assert.equal(c.eventos.length, 1);
  });

  it('remoção concorrente com renovação: não revoga, não apaga a credencial vencedora e pede nova tentativa', async () => {
    const c = montar();
    const id = semearConexao(c, 'ga4');
    c.armarCorrida(trocarRefPorOutraRequisicao);

    const resultado = await c.servico.removerConexao(pedido(id), ator);

    assert.ok(!resultado.ok);
    assert.equal(resultado.error.code, 'conflict');
    assert.equal(c.conexoes.get(id)!.status, 'active');
    assert.equal(c.conexoes.get(id)!.credentialRef, 'n8n:credential:vencedora999');
    assert.ok(!c.descartados.includes('n8n:credential:vencedora999'));
    assert.equal(c.eventos.length, 0);
    assert.equal(c.coletores.removidos.length, 0);
  });

  it('falha ao remover o coletor não derruba a remoção e fica registrada na auditoria', async () => {
    const c = montar({ removerWorkflow: false });
    const id = semearConexao(c, 'ga4');

    const resultado = await c.servico.removerConexao(pedido(id), ator);

    assert.ok(resultado.ok);
    const removida = c.eventos.find((e) => e.action === 'connection.removed')!;
    assert.equal(removida.metadata?.coletorRemovido, false);
    assert.deepEqual(removida.metadata?.workflowsOrfaos, ['wf-coletor-ga4', 'wf-executor-ga4']);
  });

  it('remoção bem-sucedida registra coletorRemovido verdadeiro', async () => {
    const c = montar();
    const id = semearConexao(c, 'ga4');
    await c.servico.removerConexao(pedido(id), ator);
    assert.equal(c.eventos.find((e) => e.action === 'connection.removed')!.metadata?.coletorRemovido, true);
  });
});
