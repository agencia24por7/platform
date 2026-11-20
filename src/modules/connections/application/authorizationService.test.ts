import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { Connection, Platform } from '@/modules/connections/domain/connection';
import type { DiscoveredAccount } from '@/modules/connections/domain/discovery';
import type { PlataformaOauth } from '@/modules/connections/domain/oauth';
import type { ConnectionRepository, NovaConexaoComId } from '@/modules/connections/infrastructure/connectionRepository';
import type { NovoSegredo } from '@/modules/tokens/application/portas';
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
const { createCofreDeTokens } = await import('@/modules/tokens/application/cofreDeTokens.ts');
const { createCifraEnvelope } = await import('@/modules/tokens/infrastructure/envelope.ts');
const { createChaveMestraLocal } = await import('@/modules/tokens/infrastructure/chavesMestras.ts');

const ORGANIZACAO = 'org-1';
const SEGREDO_DO_TOKEN = 'ya29.token-secreto-de-acesso';
const COM_COFRE = PLATAFORMAS_OAUTH.filter((plataforma) => plataforma !== 'rdstation');

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

type Guardado = { readonly connectionId: string; readonly tipo: string; readonly expiraEm: Date | null; readonly bytes: Buffer; readonly versao: number };

function montarCenario(opcoes: { falhaNoInsert?: boolean; semIdentidade?: boolean; cofreFalha?: boolean; antesDoRenew?: () => void } = {}) {
  const conexoes = new Map<string, Connection>();
  const tokens = new Map<string, Guardado>();
  const selados: { connectionId: string; segredo: string; tipo: string }[] = [];
  const descobertas: { connectionId: string; contas: readonly DiscoveredAccount[] }[] = [];
  const consultasDeDescoberta: string[] = [];
  const eventos: AuditEvent[] = [];
  const esquecidas: string[] = [];

  const gravarToken = (connectionId: string, segredo: NovoSegredo) => {
    const anterior = tokens.get(connectionId);
    tokens.set(connectionId, {
      connectionId,
      tipo: segredo.tipo,
      expiraEm: segredo.expiraEm,
      bytes: segredo.cifrado.bytes,
      versao: (anterior?.versao ?? 0) + 1,
    });
  };
  const comVersao = (conexao: Connection): Connection => ({ ...conexao, versaoDoToken: tokens.get(conexao.id)?.versao ?? null });

  const repositorio: ConnectionRepository = {
    async insert(input: NovaConexaoComId, segredo: NovoSegredo) {
      if (opcoes.falhaNoInsert) throw new Error('banco indisponível');
      const conexao: Connection = {
        ...input,
        status: input.status ?? 'active',
        authorizedAt: new Date(),
        webhookToken: null,
        versaoDoToken: null,
      };
      conexoes.set(conexao.id, conexao);
      gravarToken(conexao.id, segredo);
      return comVersao(conexao);
    },
    async findByExternalId(_organizationId: string, platform: string, externalId: string) {
      const achada = [...conexoes.values()].find((c) => c.platform === platform && c.externalId === externalId);
      return achada ? comVersao(achada) : null;
    },
    async renew(input: NovaConexaoComId, segredo: NovoSegredo, esperada: number | null) {
      opcoes.antesDoRenew?.();
      const atual = conexoes.get(input.id);
      if (!atual || (tokens.get(input.id)?.versao ?? null) !== esperada) return null;
      const renovada: Connection = { ...atual, ...input, status: input.status ?? 'active' };
      conexoes.set(renovada.id, renovada);
      gravarToken(renovada.id, segredo);
      return comVersao(renovada);
    },
    async findById() {
      return null;
    },
    async list() {
      return [];
    },
    async revogar() {
      return false;
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

  const cifra = createCifraEnvelope(createChaveMestraLocal('s'.repeat(40)));
  const cofreReal = createCofreDeTokens({
    repositorio: {} as never,
    cifra,
    provedores: () => null,
    marcador: { marcar: async () => {} },
    registro: { info() {}, aviso() {}, erro() {} },
  });
  const cofre = {
    async selar(destino: { connectionId: string; platform: Platform }, novo: { tipo: string; segredo: string; expiraEm?: Date | null }) {
      if (opcoes.cofreFalha) return { ok: false as const, error: 'indisponivel' as const };
      selados.push({ connectionId: destino.connectionId, segredo: novo.segredo, tipo: novo.tipo });
      return cofreReal.selar(destino, novo as never);
    },
    esquecer(connectionId: string) {
      esquecidas.push(connectionId);
    },
  };

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
    cofre,
    {
      async record(evento: AuditEvent) {
        eventos.push(evento);
      },
    } as never,
    () => new Date('2026-11-20T12:00:00Z'),
  );

  const decifrar = (guardado: Guardado, platform: Platform) =>
    cifra.decifrar(guardado.bytes, { connectionId: guardado.connectionId, platform, finalidade: 'segredo' });

  return { servico, conexoes, tokens, selados, descobertas, consultasDeDescoberta, eventos, esquecidas, decifrar };
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

const ehGoogle = (plataforma: string) => (FAMILIA_GOOGLE as readonly string[]).includes(plataforma);

for (const plataforma of COM_COFRE) {
  describe(`conectar ${plataforma}`, () => {
    it('cifra o segredo de longa duração no cofre junto com a conexão, descobre os recursos e audita, sem n8n', async () => {
      const c = montarCenario();
      const resultado = await c.servico.complete(pedido(plataforma));

      assert.ok(resultado.ok, 'a autorização devia concluir');
      assert.equal(resultado.value.discovered, plataforma === 'whatsapp' ? 0 : 1);
      assert.equal(resultado.value.organizationCreated, false);

      const [conexao] = [...c.conexoes.values()];
      assert.equal(c.conexoes.size, 1);
      assert.equal(conexao!.status, 'active');
      assert.equal(conexao!.externalId, `identidade-${plataforma}`);
      assert.equal(conexao!.authorizedVia, 'staff');

      const guardado = c.tokens.get(conexao!.id)!;
      assert.equal(guardado.versao, 1);
      if (ehGoogle(plataforma)) {
        assert.equal(guardado.tipo, 'oauth_refresh');
        assert.equal(await c.decifrar(guardado, plataforma), 'refresh-secreto');
        assert.equal(conexao!.expiresAt, null);
      } else {
        assert.equal(guardado.tipo, 'oauth_long_lived');
        assert.equal(await c.decifrar(guardado, plataforma), SEGREDO_DO_TOKEN);
        assert.equal(guardado.expiraEm!.toISOString(), '2026-11-20T13:00:00.000Z');
        assert.equal(conexao!.expiresAt!.toISOString(), '2026-11-20T13:00:00.000Z');
      }
      assert.ok(!guardado.bytes.toString('latin1').includes('refresh-secreto'));
      assert.ok(!guardado.bytes.toString('latin1').includes(SEGREDO_DO_TOKEN));
      assert.deepEqual(c.esquecidas, [conexao!.id]);

      const fora = JSON.stringify([...c.conexoes.values()]) + JSON.stringify(c.eventos);
      assert.ok(!fora.includes(SEGREDO_DO_TOKEN), 'o token apareceu fora do cofre');
      assert.ok(!fora.includes('refresh-secreto'), 'o refresh token apareceu fora do cofre');
      assert.ok(!fora.includes('segredo-do-cliente-da-plataforma'), 'o segredo do app apareceu fora do cofre');

      const autorizacoes = c.eventos.filter((evento) => evento.action === 'connection.authorize');
      assert.equal(autorizacoes.length, 1);
      assert.equal(autorizacoes[0]!.targetId, conexao!.id);
      assert.equal(autorizacoes[0]!.organizationId, ORGANIZACAO);
      assert.equal(autorizacoes[0]!.metadata?.platform, plataforma);
      assert.equal(autorizacoes[0]!.metadata?.segredoNoCofre, ehGoogle(plataforma) ? 'oauth_refresh' : 'oauth_long_lived');
      assert.equal(autorizacoes[0]!.metadata?.renovouConexao, false);
    });

    it('descobre só os recursos da própria plataforma e grava como conta descoberta da conexão', async () => {
      const c = montarCenario();
      await c.servico.complete(pedido(plataforma));

      const semDescoberta = plataforma === 'whatsapp';
      assert.deepEqual(c.consultasDeDescoberta, semDescoberta ? [] : [plataforma]);

      const [conexao] = [...c.conexoes.values()];
      assert.equal(c.descobertas.length, 1);
      assert.equal(c.descobertas[0]!.connectionId, conexao!.id);
      assert.equal(c.descobertas[0]!.contas.length, semDescoberta ? 0 : 1);
    });

    it('reconectar a mesma identidade renova a MESMA conexão e troca o token com versão nova', async () => {
      const c = montarCenario();
      const primeira = await c.servico.complete(pedido(plataforma));
      responderToken({ corpo: { access_token: `${SEGREDO_DO_TOKEN}-2`, refresh_token: 'refresh-secreto-2', expires_in: 3600 } });
      const segunda = await c.servico.complete(pedido(plataforma));

      assert.ok(primeira.ok && segunda.ok);
      assert.equal(c.conexoes.size, 1, 'reconectar não pode criar outra conexão');
      assert.equal(segunda.value.connectionId, primeira.value.connectionId);

      const guardado = c.tokens.get(segunda.value.connectionId)!;
      assert.equal(guardado.versao, 2);
      assert.equal(await c.decifrar(guardado, plataforma), ehGoogle(plataforma) ? 'refresh-secreto-2' : `${SEGREDO_DO_TOKEN}-2`);

      const autorizacoes = c.eventos.filter((evento) => evento.action === 'connection.authorize');
      assert.equal(autorizacoes.length, 2);
      assert.equal(autorizacoes[1]!.metadata?.renovouConexao, true);
    });

    it('conexão em reauth_pending sem token (pós-corte) volta a active com o mesmo id', async () => {
      const c = montarCenario();
      const primeira = await c.servico.complete(pedido(plataforma));
      assert.ok(primeira.ok);
      const id = primeira.value.connectionId;
      c.conexoes.set(id, { ...c.conexoes.get(id)!, status: 'reauth_pending' });
      c.tokens.delete(id);

      const reautorizada = await c.servico.complete(pedido(plataforma));
      assert.ok(reautorizada.ok);
      assert.equal(reautorizada.value.connectionId, id);
      assert.equal(c.conexoes.get(id)!.status, 'active');
      assert.equal(c.tokens.get(id)!.versao, 1);
    });

    it('renovação concorrente: quem leu a versão velha recebe conflito e não sobrescreve o token mais novo', async () => {
      let intrometer = false;
      const c = montarCenario({
        antesDoRenew: () => {
          if (!intrometer) return;
          intrometer = false;
          const [conexao] = [...c.conexoes.values()];
          const atual = c.tokens.get(conexao!.id)!;
          c.tokens.set(conexao!.id, { ...atual, versao: atual.versao + 1 });
        },
      });
      const primeira = await c.servico.complete(pedido(plataforma));
      assert.ok(primeira.ok);
      const antes = c.tokens.get(primeira.value.connectionId)!;

      intrometer = true;
      const atrasada = await c.servico.complete(pedido(plataforma));
      assert.ok(!atrasada.ok);
      assert.equal(atrasada.error.code, 'conflict');
      const depois = c.tokens.get(primeira.value.connectionId)!;
      assert.equal(depois.versao, antes.versao + 1, 'o token da outra requisição ficou');
      assert.equal(depois.bytes, antes.bytes);
    });

    it('recusa quem não administra, sem falar com a plataforma nem tocar no cofre', async () => {
      for (const papel of ['viewer', 'operator'] as const) {
        const c = montarCenario();
        const resultado = await c.servico.complete(pedido(plataforma, { autorizadoPor: { via: 'staff', papel } }));

        assert.ok(!resultado.ok);
        assert.equal(resultado.error.code, 'forbidden');
        assert.equal(chamadasDeToken.length, 0);
        assert.equal(c.selados.length, 0);
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
      assert.equal(c.selados.length, 0);
      assert.equal(c.conexoes.size, 0);
      assert.equal(c.eventos.length, 0);
    });

    it('resposta sem access_token não guarda nada', async () => {
      responderToken({ corpo: { token_type: 'bearer' } });
      const c = montarCenario();
      const resultado = await c.servico.complete(pedido(plataforma));

      assert.ok(!resultado.ok);
      assert.equal(c.selados.length, 0);
      assert.equal(c.conexoes.size, 0);
    });

    it('plataforma sem identidade do concedente não guarda credencial', async () => {
      const c = montarCenario({ semIdentidade: true });
      const resultado = await c.servico.complete(pedido(plataforma));

      assert.ok(!resultado.ok);
      assert.equal(c.selados.length, 0);
      assert.equal(c.conexoes.size, 0);
    });

    it('falha ao gravar a conexão não deixa token nem conexão (mesma transação)', async () => {
      const c = montarCenario({ falhaNoInsert: true });
      await assert.rejects(c.servico.complete(pedido(plataforma)), /banco indisponível/);
      assert.equal(c.tokens.size, 0);
      assert.equal(c.conexoes.size, 0);
      assert.equal(c.eventos.length, 0);
    });

    it('cofre indisponível recusa a autorização: nunca existe conexão ativa sem token', async () => {
      const c = montarCenario({ cofreFalha: true });
      const resultado = await c.servico.complete(pedido(plataforma));
      assert.ok(!resultado.ok);
      assert.equal(resultado.error.code, 'unavailable');
      assert.equal(c.conexoes.size, 0);
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

describe('segredo que o cofre não sabe guardar', () => {
  it('Google sem refresh token é recusado sem criar conexão', async () => {
    responderToken({ corpo: { access_token: SEGREDO_DO_TOKEN, expires_in: 3600 } });
    const c = montarCenario();
    const resultado = await c.servico.complete(pedido('ga4'));
    assert.ok(!resultado.ok);
    assert.match(resultado.error.message, /refresh token/);
    assert.equal(c.conexoes.size, 0);
  });

  it('RD Station por OAuth é recusado: a conexão do RD é por chave de API', async () => {
    const c = montarCenario();
    const resultado = await c.servico.complete(pedido('rdstation'));
    assert.ok(!resultado.ok);
    assert.equal(c.conexoes.size, 0);
  });

  it('Meta sem expires_in assume 60 dias de validade', async () => {
    responderToken({ corpo: { access_token: SEGREDO_DO_TOKEN } });
    const c = montarCenario();
    const resultado = await c.servico.complete(pedido('meta'));
    assert.ok(resultado.ok);
    assert.equal(c.tokens.get(resultado.value.connectionId)!.expiraEm!.toISOString(), '2027-01-19T12:00:00.000Z');
  });
});

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
      assert.equal(c.selados.length, 0);
      assert.equal(c.conexoes.size, 0, escopo);
    });
  }
});

describe('conexões de plataformas diferentes na mesma organização', () => {
  it('cada plataforma ganha a própria conexão e o próprio token', async () => {
    const c: Cenario = montarCenario();
    for (const plataforma of COM_COFRE) {
      const resultado = await c.servico.complete(pedido(plataforma));
      assert.ok(resultado.ok);
    }

    assert.equal(c.conexoes.size, COM_COFRE.length);
    assert.equal(c.tokens.size, COM_COFRE.length);
  });
});
