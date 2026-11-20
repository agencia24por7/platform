import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { Connection, NewConnection, Platform } from '@/modules/connections/domain/connection';
import type { DiscoveredAccount } from '@/modules/connections/domain/discovery';
import type { PlataformaOauth } from '@/modules/connections/domain/oauth';
import type { ConnectionRepository } from '@/modules/connections/infrastructure/connectionRepository';
import type { PlatformDiscovery } from '@/modules/connections/application/platformDiscoveryPort';
import type { AuthorizationInput } from './authorizationService.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createAuthorizationService } = await import('./authorizationService.ts');
const { PLATAFORMAS_OAUTH, FAMILIA_GOOGLE, FAMILIA_META } = await import('@/modules/connections/domain/oauth.ts');
const { CREDENCIAL_SEM_COFRE } = await import('@/modules/connections/domain/connection.ts');

const ORGANIZACAO = 'org-1';
const SEGREDO_DO_TOKEN = 'ya29.token-secreto-de-acesso';

function conta(platform: Platform): DiscoveredAccount {
  return {
    platform,
    externalId: `recurso-${platform}`,
    name: `Recurso ${platform}`,
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    managerExternalId: null,
    spendingLast30Days: null,
    inactive: false,
  };
}

type Cenario = ReturnType<typeof montarCenario>;

function montarCenario(opcoes: { cofre?: boolean; falhaNoInsert?: boolean; semIdentidade?: boolean } = {}) {
  const cofreDisponivel = opcoes.cofre ?? true;
  const conexoes = new Map<string, Connection>();
  const cofre = { armazenados: [] as string[], descartados: [] as string[], segredos: [] as unknown[] };
  const coletores = { criados: [] as string[], removidos: [] as string[] };
  const executores = { criados: [] as string[], removidos: [] as string[] };
  const refsAtuais = new Map<string, { coletor: string | null; executor: string | null }>();
  const descobertas: { connectionId: string; contas: readonly DiscoveredAccount[] }[] = [];
  const consultasDeDescoberta: string[] = [];
  const eventos: AuditEvent[] = [];
  let sequencia = 0;

  const repositorio: ConnectionRepository = {
    async insert(input: NewConnection) {
      if (opcoes.falhaNoInsert) throw new Error('banco indisponível');
      const conexao: Connection = {
        ...input,
        id: `conn-${++sequencia}`,
        status: input.status ?? 'active',
        authorizedAt: new Date(),
        webhookToken: null,
      };
      conexoes.set(conexao.id, conexao);
      refsAtuais.set(conexao.id, { coletor: null, executor: null });
      return conexao;
    },
    async findByExternalId(_organizationId, platform, externalId) {
      return [...conexoes.values()].find((c) => c.platform === platform && c.externalId === externalId) ?? null;
    },
    async renew(input, esperada) {
      const atual = conexoes.get(input.id)!;
      if (atual.credentialRef !== esperada) return null;
      const renovada: Connection = { ...atual, ...input, status: input.status ?? 'active' };
      conexoes.set(renovada.id, renovada);
      return renovada;
    },
    async trocarColetorRef(_organizationId, id, ref) {
      const refs = refsAtuais.get(id)!;
      const anterior = refs.coletor;
      refs.coletor = ref;
      return anterior;
    },
    async trocarExecutorRef(_organizationId, id, ref) {
      const refs = refsAtuais.get(id)!;
      const anterior = refs.executor;
      refs.executor = ref;
      return anterior;
    },
    async findById() {
      return null;
    },
    async list() {
      return [];
    },
    async revogar() {
      return null;
    },
  };

  const descobrir = (platform: Platform) => async () => {
    consultasDeDescoberta.push(platform);
    return [conta(platform)];
  };

  const descoberta = {
    google: descobrir('google'),
    meta: descobrir('meta'),
    pixel: descobrir('pixel'),
    leadads: descobrir('leadads'),
    ga4: descobrir('ga4'),
    gtm: descobrir('gtm'),
    searchconsole: descobrir('searchconsole'),
    youtube: descobrir('youtube'),
    gbp: descobrir('gbp'),
    async identify(platform: Platform) {
      return opcoes.semIdentidade ? null : { id: `identidade-${platform}`, email: `${platform}@cliente.test` };
    },
    lastFailure: () => null,
    lastSweep: () => ({ raizes: 0, brutas: 0, administradoras: 0, recusadas: 0 }),
  } as unknown as PlatformDiscovery;

  const servico = createAuthorizationService(
    {
      exists: async () => true,
      byId: async (id: string) => ({
        ok: true,
        value: { id, slug: 'agencia', name: 'Agência', managerAccountId: null, businessManagerId: null },
      }),
    } as never,
    repositorio,
    {
      async replace(_organizationId: string, connectionId: string, contas: readonly DiscoveredAccount[]) {
        descobertas.push({ connectionId, contas });
        return contas.length;
      },
    } as never,
    descoberta,
    {
      available: cofreDisponivel,
      async store(segredo: unknown) {
        cofre.segredos.push(segredo);
        const ref = `n8n:credential:cred${cofre.armazenados.length + 1}abc`;
        cofre.armazenados.push(ref);
        return ref;
      },
      async discard(ref: string) {
        cofre.descartados.push(ref);
        return 'descartada' as const;
      },
    },
    {
      async record(evento: AuditEvent) {
        eventos.push(evento);
      },
    } as never,
    {
      async provisionar() {
        const ref = `wf-coletor-${coletores.criados.length + 1}`;
        coletores.criados.push(ref);
        return ref;
      },
      async remover(ref: string) {
        coletores.removidos.push(ref);
        return true;
      },
    } as never,
    {
      async provisionar() {
        const ref = `wf-executor-${executores.criados.length + 1}`;
        executores.criados.push(ref);
        return ref;
      },
      async remover(ref: string) {
        executores.removidos.push(ref);
        return true;
      },
    } as never,
  );

  return { servico, conexoes, cofre, coletores, executores, refsAtuais, descobertas, consultasDeDescoberta, eventos };
}

function pedido(platform: PlataformaOauth, extra: Partial<AuthorizationInput> = {}): AuthorizationInput {
  return {
    organizationId: ORGANIZACAO,
    autorizadoPor: { via: 'staff', papel: 'owner' },
    actorId: 'user-1',
    platform,
    code: 'codigo-de-autorizacao',
    codeVerifier: 'verificador',
    redirectUri: `http://localhost:3000/api/oauth/${platform}/callback`,
    clientId: 'cliente-id-da-plataforma',
    clientSecret: 'segredo-do-cliente-da-plataforma',
    requestId: 'req-1',
    sourceIp: null,
    ...extra,
  };
}

const original = globalThis.fetch;
let chamadasDeToken: string[] = [];

function responderToken(resposta: { status?: number; corpo?: unknown } = {}) {
  globalThis.fetch = (async (url: string | URL | Request) => {
    chamadasDeToken.push(String(url));
    return new Response(
      JSON.stringify(
        resposta.corpo ?? { access_token: SEGREDO_DO_TOKEN, refresh_token: 'refresh-secreto', expires_in: 3600 },
      ),
      { status: resposta.status ?? 200 },
    );
  }) as typeof fetch;
}

beforeEach(() => {
  chamadasDeToken = [];
  responderToken();
});

afterEach(() => {
  globalThis.fetch = original;
});

describe('a lista cobre todas as plataformas OAuth', () => {
  it('família Google e família Meta, mais RD Station', () => {
    assert.deepEqual(
      [...PLATAFORMAS_OAUTH].sort(),
      [...FAMILIA_GOOGLE, ...FAMILIA_META, 'rdstation'].sort(),
    );
  });
});

for (const plataforma of PLATAFORMAS_OAUTH) {
  describe(`conectar ${plataforma}`, () => {
    it('guarda o segredo no cofre, descobre os recursos, provisiona coletor e executor uma vez e audita', async () => {
      const c = montarCenario();
      const resultado = await c.servico.complete(pedido(plataforma));

      assert.ok(resultado.ok, 'a autorização devia concluir');
      assert.equal(resultado.value.discovered, plataforma === 'rdstation' || plataforma === 'whatsapp' ? 0 : 1);
      assert.equal(resultado.value.organizationCreated, false);

      assert.equal(c.cofre.armazenados.length, 1);
      const [segredo] = c.cofre.segredos as { accessToken: string; refreshToken: string | null; platform: string }[];
      assert.equal(segredo!.accessToken, SEGREDO_DO_TOKEN);
      assert.equal(segredo!.refreshToken, 'refresh-secreto');
      assert.equal(segredo!.platform, plataforma);

      const [conexao] = [...c.conexoes.values()];
      assert.equal(c.conexoes.size, 1);
      assert.equal(conexao!.credentialRef, c.cofre.armazenados[0]);
      assert.equal(conexao!.status, 'active');
      assert.equal(conexao!.externalId, `identidade-${plataforma}`);
      assert.equal(conexao!.authorizedVia, 'staff');

      assert.equal(c.coletores.criados.length, 1);
      assert.equal(c.executores.criados.length, 1);
      assert.deepEqual(c.refsAtuais.get(conexao!.id), { coletor: 'wf-coletor-1', executor: 'wf-executor-1' });
      assert.equal(c.coletores.removidos.length, 0);

      const guardado = JSON.stringify([...c.conexoes.values()]) + JSON.stringify(c.eventos);
      assert.ok(!guardado.includes(SEGREDO_DO_TOKEN), 'o token apareceu fora do cofre');
      assert.ok(!guardado.includes('refresh-secreto'), 'o refresh token apareceu fora do cofre');
      assert.ok(!guardado.includes('segredo-do-cliente-da-plataforma'), 'o segredo do app apareceu fora do cofre');

      const autorizacoes = c.eventos.filter((evento) => evento.action === 'connection.authorize');
      assert.equal(autorizacoes.length, 1);
      assert.equal(autorizacoes[0]!.targetId, conexao!.id);
      assert.equal(autorizacoes[0]!.organizationId, ORGANIZACAO);
      assert.equal(autorizacoes[0]!.metadata?.platform, plataforma);
      assert.equal(autorizacoes[0]!.metadata?.vaultAvailable, true);
    });

    it('descobre só os recursos da própria plataforma e grava como conta descoberta da conexão', async () => {
      const c = montarCenario();
      await c.servico.complete(pedido(plataforma));

      const semDescoberta = plataforma === 'rdstation' || plataforma === 'whatsapp';
      assert.deepEqual(c.consultasDeDescoberta, semDescoberta ? [] : [plataforma]);

      const [conexao] = [...c.conexoes.values()];
      assert.equal(c.descobertas.length, 1);
      assert.equal(c.descobertas[0]!.connectionId, conexao!.id);
      assert.equal(c.descobertas[0]!.contas.length, semDescoberta ? 0 : 1);
    });

    it('reconectar a mesma identidade renova a conexão, descarta a credencial velha e troca o coletor sem duplicar', async () => {
      const c = montarCenario();
      const primeira = await c.servico.complete(pedido(plataforma));
      const segunda = await c.servico.complete(pedido(plataforma));

      assert.ok(primeira.ok && segunda.ok);
      assert.equal(c.conexoes.size, 1, 'reconectar não pode criar outra conexão');
      assert.equal(segunda.value.connectionId, primeira.value.connectionId);

      const [conexao] = [...c.conexoes.values()];
      assert.equal(conexao!.credentialRef, c.cofre.armazenados[1]);
      assert.deepEqual(c.cofre.descartados, [c.cofre.armazenados[0]]);

      assert.equal(c.coletores.criados.length, 2);
      assert.deepEqual(c.coletores.removidos, ['wf-coletor-1']);
      assert.deepEqual(c.executores.removidos, ['wf-executor-1']);
      assert.deepEqual(c.refsAtuais.get(conexao!.id), { coletor: 'wf-coletor-2', executor: 'wf-executor-2' });

      const autorizacoes = c.eventos.filter((evento) => evento.action === 'connection.authorize');
      assert.equal(autorizacoes.length, 2);
      assert.equal(autorizacoes[1]!.metadata?.credencialAnterior, 'descartada');
    });

    it('recusa quem não administra, sem falar com a plataforma nem tocar no cofre', async () => {
      for (const papel of ['viewer', 'operator'] as const) {
        const c = montarCenario();
        const resultado = await c.servico.complete(pedido(plataforma, { autorizadoPor: { via: 'staff', papel } }));

        assert.ok(!resultado.ok);
        assert.equal(resultado.error.code, 'forbidden');
        assert.equal(chamadasDeToken.length, 0);
        assert.equal(c.cofre.armazenados.length, 0);
        assert.equal(c.conexoes.size, 0);
        assert.equal(c.eventos.length, 0);
      }
    });

    it('troca de código recusada pela plataforma não guarda nada', async () => {
      responderToken({ status: 400, corpo: { error: 'invalid_grant' } });
      const c = montarCenario();
      const resultado = await c.servico.complete(pedido(plataforma));

      assert.ok(!resultado.ok);
      assert.equal(resultado.error.code, 'unavailable');
      assert.equal(c.cofre.armazenados.length, 0);
      assert.equal(c.conexoes.size, 0);
      assert.equal(c.coletores.criados.length, 0);
      assert.equal(c.eventos.length, 0);
    });

    it('resposta sem access_token não guarda nada', async () => {
      responderToken({ corpo: { token_type: 'bearer' } });
      const c = montarCenario();
      const resultado = await c.servico.complete(pedido(plataforma));

      assert.ok(!resultado.ok);
      assert.equal(c.cofre.armazenados.length, 0);
      assert.equal(c.conexoes.size, 0);
    });

    it('plataforma sem identidade do concedente não guarda credencial', async () => {
      const c = montarCenario({ semIdentidade: true });
      const resultado = await c.servico.complete(pedido(plataforma));

      assert.ok(!resultado.ok);
      assert.equal(c.cofre.armazenados.length, 0);
      assert.equal(c.conexoes.size, 0);
      assert.equal(c.coletores.criados.length, 0);
    });

    it('falha ao gravar a conexão descarta a credencial recém-guardada', async () => {
      const c = montarCenario({ falhaNoInsert: true });
      await assert.rejects(c.servico.complete(pedido(plataforma)), /banco indisponível/);

      assert.deepEqual(c.cofre.descartados, c.cofre.armazenados);
      assert.equal(c.coletores.criados.length, 0);
      assert.equal(c.eventos.length, 0);
    });

    it('sem cofre a conexão fica degradada, sem credencial e sem coletor', async () => {
      const c = montarCenario({ cofre: false });
      const resultado = await c.servico.complete(pedido(plataforma));

      assert.ok(resultado.ok);
      const [conexao] = [...c.conexoes.values()];
      assert.equal(conexao!.status, 'degraded');
      assert.equal(conexao!.credentialRef, CREDENCIAL_SEM_COFRE);
      assert.equal(c.cofre.armazenados.length, 0);
      assert.equal(c.coletores.criados.length, 0);
      assert.equal(c.executores.criados.length, 0);
    });

    it('autorização por convite grava a origem e audita como convite', async () => {
      const c = montarCenario();
      const resultado = await c.servico.complete(
        pedido(plataforma, { autorizadoPor: { via: 'invite', inviteItemId: 'item-1' }, actorId: 'item-1' }),
      );

      assert.ok(resultado.ok);
      const [conexao] = [...c.conexoes.values()];
      assert.equal(conexao!.authorizedVia, 'invite');
      const [evento] = c.eventos;
      assert.equal(evento!.actorType, 'invite');
      assert.equal(evento!.metadata?.inviteItemId, 'item-1');
    });
  });
}

describe('permissões da autorização', () => {
  const exigida: Record<string, string> = {
    google: 'https://www.googleapis.com/auth/adwords',
    ga4: 'https://www.googleapis.com/auth/analytics.readonly',
    meta: 'ads_read',
    leadads: 'leads_retrieval',
  };

  for (const [plataforma, escopo] of Object.entries(exigida)) {
    it(`${plataforma} sem o escopo mínimo de leitura é recusada antes do cofre`, async () => {
      responderToken({ corpo: { access_token: SEGREDO_DO_TOKEN, scope: 'email' } });
      const c = montarCenario();
      const resultado = await c.servico.complete(pedido(plataforma as PlataformaOauth));

      assert.ok(!resultado.ok);
      assert.equal(resultado.error.code, 'forbidden');
      assert.equal(c.cofre.armazenados.length, 0);
      assert.equal(c.conexoes.size, 0, escopo);
    });
  }
});

describe('conexões de plataformas diferentes na mesma organização', () => {
  it('cada plataforma ganha a própria conexão, credencial e coletor', async () => {
    const c: Cenario = montarCenario();
    for (const plataforma of PLATAFORMAS_OAUTH) {
      const resultado = await c.servico.complete(pedido(plataforma));
      assert.ok(resultado.ok);
    }

    assert.equal(c.conexoes.size, PLATAFORMAS_OAUTH.length);
    assert.equal(new Set([...c.conexoes.values()].map((x) => x.credentialRef)).size, PLATAFORMAS_OAUTH.length);
    assert.equal(c.coletores.criados.length, PLATAFORMAS_OAUTH.length);
    assert.equal(c.coletores.removidos.length, 0);
  });
});
