import { randomUUID } from 'node:crypto';
import { createConnectionRepository } from '@/modules/connections/infrastructure/connectionRepository';
import { createCofreDeTokens } from '@/modules/tokens/application/cofreDeTokens';
import { createChaveMestraLocal } from '@/modules/tokens/infrastructure/chavesMestras';
import { createCifraEnvelope } from '@/modules/tokens/infrastructure/envelope';
import { createMarcadorDeReautorizacao, createTokenRepository } from '@/modules/tokens/infrastructure/tokenRepository';
import type { ProvedorDeToken } from '@/modules/tokens/application/portas';
import { createAuthorizationService } from '@/modules/connections/application/authorizationService';
import { createConnectionService } from '@/modules/connections/application/connectionService';
import { createDiscoveredAccountRepository } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import type { PlatformDiscovery } from '@/modules/connections/application/platformDiscoveryPort';
import { comoPublico, sql } from '@/shared/db/client';
import { withTenant } from '@/shared/db/tenant';

const organizationId = process.argv[2]!;
const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

const chamadasAoProvedor: string[] = [];
const ATRASO_DO_PROVEDOR_MS = 800;
const provedor: ProvedorDeToken = {
  async renovar(segredo) {
    chamadasAoProvedor.push(segredo);
    await esperar(ATRASO_DO_PROVEDOR_MS);
    return { ok: true, value: { accessToken: `acesso-de-${segredo}`, expiraEm: new Date(Date.now() + 3_600_000) } };
  },
  async revogar() {
    return { ok: true, value: 'revogado' };
  },
};

const cifra = createCifraEnvelope(createChaveMestraLocal(process.env.TRIA_SESSION_SECRET!));
const novoCofre = () =>
  createCofreDeTokens({
    repositorio: createTokenRepository(),
    cifra,
    provedores: () => provedor,
    marcador: createMarcadorDeReautorizacao(),
    registro: { info() {}, aviso() {}, erro() {} },
  });

async function main() {
  const conexoes = createConnectionRepository();
  const cofre = novoCofre();
  const id = randomUUID();
  const base = {
    id,
    organizationId,
    platform: 'ga4' as const,
    grantType: 'oauth_user' as const,
    label: 'GA4 do cofre',
    externalId: `ga4-cofre-${id.slice(0, 8)}`,
    accountEmail: 'dono@cliente.test',
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    expiresAt: null,
    authorizedVia: 'staff' as const,
  };
  const selar = async (segredo: string) => {
    const selado = await cofre.selar({ connectionId: id, platform: 'ga4' }, { tipo: 'oauth_refresh', segredo });
    if (!selado.ok) throw new Error(selado.error);
    return selado.value;
  };

  const criada = await conexoes.insert(base, await selar('refresh-1'));
  const renovada = await conexoes.renew(base, await selar('refresh-2'), criada.versaoDoToken);
  const atrasada = await conexoes.renew(base, await selar('refresh-velho'), criada.versaoDoToken);
  const depoisDoConflito = await conexoes.findById(organizationId, id);

  const outro = novoCofre();
  const inicio = Date.now();
  const pedidos = [
    ...Array.from({ length: 5 }, () => cofre.obterAcesso({ organizationId, connectionId: id })),
    ...Array.from({ length: 5 }, () => outro.obterAcesso({ organizationId, connectionId: id })),
  ];
  await esperar(150);
  const inicioDaEscrita = Date.now();
  const leaseVisivel = await withTenant(organizationId, async (tx) => {
    const linhas = (await tx`
      SELECT renovacao_iniciada_em IS NOT NULL AS em_curso FROM integrations.connection_tokens WHERE connection_id = ${id}`) as unknown as {
      em_curso: boolean;
    }[];
    await tx`UPDATE integrations.connections SET label = 'GA4 do cofre (editada durante a renovação)' WHERE id = ${id}`;
    await tx`SELECT versao FROM integrations.connection_tokens WHERE connection_id = ${id} FOR UPDATE`;
    return linhas[0]?.em_curso ?? false;
  });
  const escritaDuranteARenovacaoMs = Date.now() - inicioDaEscrita;
  const acessos = await Promise.all(pedidos);
  const duracaoMs = Date.now() - inicio;
  const transacoesPresas = (await sql()`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE application_name = 'orla-app' AND state = 'idle in transaction'`) as unknown as { n: number }[];

  const versaoAntesDeRemover = (await conexoes.findById(organizationId, id))!.versaoDoToken;
  const removerVelho = await conexoes.revogar(organizationId, id, (versaoAntesDeRemover ?? 0) - 1);
  const remocao = await cofre.revogarEApagar(
    { organizationId, connectionId: id },
    { apagar: (versao) => conexoes.revogar(organizationId, id, versao) },
  );
  const removida = await conexoes.findById(organizationId, id);

  let ativaSemToken = '';
  try {
    await withTenant(organizationId, async (tx) => {
      await tx`
        INSERT INTO integrations.connections (organization_id, platform, grant_type, label, external_id, scopes)
        VALUES (${organizationId}, 'gtm', 'oauth_user', 'sem token', ${`sem-token-${id.slice(0, 8)}`}, ARRAY[]::text[])`;
    });
  } catch (erro) {
    ativaSemToken = erro instanceof Error ? erro.message : String(erro);
  }

  const corridas = await corridasComReautorizacao(conexoes, cofre);
  const autorizacao = await autorizacaoContraOBanco(conexoes, cofre);
  const chave = await chaveContraOBanco(conexoes, cofre);

  console.log(
    JSON.stringify({
      corridas,
      autorizacao,
      chave,
      criada: { versao: criada.versaoDoToken, status: criada.status },
      renovada: { id: renovada?.id, versao: renovada?.versaoDoToken },
      atrasadaRecusada: atrasada === null,
      versaoDepoisDoConflito: depoisDoConflito?.versaoDoToken,
      chamadasAoProvedor,
      acessos: [...new Set(acessos.map((acesso) => (acesso.ok ? acesso.value.token : `erro:${acesso.error}`)))],
      duracaoMs,
      leaseVisivel,
      escritaDuranteARenovacaoMs,
      transacoesPresas: transacoesPresas[0]?.n ?? -1,
      removerVelhoRecusado: removerVelho === false,
      remocao,
      removida: { status: removida?.status, versao: removida?.versaoDoToken, email: removida?.accountEmail },
      ativaSemToken,
    }),
  );
  await sql().end();
}

async function corridasComReautorizacao(
  conexoes: ReturnType<typeof createConnectionRepository>,
  cofre: ReturnType<typeof novoCofre>,
) {
  const repositorio = createTokenRepository();
  const marcador = createMarcadorDeReautorizacao();
  const id = randomUUID();
  const base = {
    id,
    organizationId,
    platform: 'gtm' as const,
    grantType: 'oauth_user' as const,
    label: 'GTM da corrida',
    externalId: `gtm-corrida-${id.slice(0, 8)}`,
    accountEmail: null,
    scopes: [],
    expiresAt: null,
    authorizedVia: 'staff' as const,
  };
  const selar = async (segredo: string) => {
    const selado = await cofre.selar({ connectionId: id, platform: 'gtm' }, { tipo: 'oauth_refresh', segredo });
    if (!selado.ok) throw new Error(selado.error);
    return selado.value;
  };
  const alvo = { organizationId, connectionId: id };
  const criada = await conexoes.insert(base, await selar('refresh-velho'));

  const concessaoA = randomUUID();
  const a = await repositorio.reivindicarRenovacao(alvo, 15_000, concessaoA);
  const reautorizada = await conexoes.renew(base, await selar('refresh-novo'), criada.versaoDoToken);
  await marcador.marcar(alvo, 'invalid_grant', a.registro!.versao);
  const statusDepoisDaFalhaVelha = (await conexoes.findById(organizationId, id))!.status;

  const concessaoB = randomUUID();
  const b = await repositorio.reivindicarRenovacao(alvo, 15_000, concessaoB);
  await repositorio.liberarRenovacao(alvo, concessaoA, 'invalid_grant');
  const depois = (await withTenant(organizationId, (tx) => tx`
    SELECT renovacao_dono::text AS dono, ultima_falha_codigo AS falha FROM integrations.connection_tokens WHERE connection_id = ${id}`)) as unknown as {
    dono: string | null;
    falha: string | null;
  }[];
  const gravouAtrasado = await repositorio.concluirRenovacao(alvo, a.registro!.versao, concessaoA, { falha: null, renovadoEm: new Date() });
  const donoDepoisDoAtrasado = (await withTenant(organizationId, (tx) => tx`
    SELECT renovacao_dono::text AS dono FROM integrations.connection_tokens WHERE connection_id = ${id}`)) as unknown as { dono: string | null }[];

  return {
    aDono: a.dono,
    reautorizadaVersao: reautorizada?.versaoDoToken,
    statusDepoisDaFalhaVelha,
    bDono: b.dono,
    leaseDeBPreservado: depois[0]?.dono === concessaoB,
    falhaVelhaNaoGravada: depois[0]?.falha === null,
    gravouAtrasado,
    leaseDeBDepoisDoAtrasado: donoDepoisDoAtrasado[0]?.dono === concessaoB,
  };
}

const descoberta = {
  google: async () => [],
  meta: async () => [],
  ga4: async () => [],
  gtm: async () => [],
  searchconsole: async () => [],
  youtube: async () => [],
  gbp: async () => [],
  pixel: async () => [],
  leadads: async () => [],
  identify: async (platform: string) => ({ id: `identidade-${platform}-${organizationId.slice(0, 8)}`, email: `${platform}@cliente.test` }),
  lastFailure: () => null,
  lastSweep: () => ({ raizes: 0, brutas: 0, administradoras: 0, recusadas: 0 }),
} as unknown as PlatformDiscovery;

async function autorizacaoContraOBanco(
  conexoes: ReturnType<typeof createConnectionRepository>,
  cofre: ReturnType<typeof novoCofre>,
) {
  const original = globalThis.fetch;
  let refresh = 'refresh-1';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: `acesso-${refresh}`, refresh_token: refresh, expires_in: 3600 }), { status: 200 })) as typeof fetch;
  try {
    const servico = createAuthorizationService(
      {
        exists: async () => true,
        byId: async (id: string) => ({ ok: true, value: { id, slug: 'cofre', name: 'Cofre', managerAccountId: null, businessManagerId: null } }),
      } as never,
      conexoes,
      createDiscoveredAccountRepository(),
      descoberta,
      cofre,
      { record: async () => {} } as never,
    );
    const pedido = (platform: 'ga4' | 'meta') => ({
      organizationId,
      autorizadoPor: { via: 'staff' as const, papel: 'owner' as const },
      actorId: 'harness',
      platform,
      code: 'codigo',
      codeVerifier: 'verificador',
      redirectUri: 'http://app/callback',
      clientId: 'cliente',
      clientSecret: 'segredo-do-app',
      requestId: 'req',
      sourceIp: null,
    });
    const resultados: Record<string, unknown> = {};
    for (const platform of ['ga4', 'meta'] as const) {
      refresh = `refresh-${platform}-1`;
      const primeira = await servico.complete(pedido(platform));
      if (!primeira.ok) throw new Error(`autorizar ${platform}: ${primeira.error.message}`);
      const id = primeira.value.connectionId;
      await withTenant(organizationId, async (tx) => {
        await tx`DELETE FROM integrations.connection_tokens WHERE connection_id = ${id}`;
        await tx`UPDATE integrations.connections SET status = 'reauth_pending' WHERE id = ${id}`;
      });
      refresh = `refresh-${platform}-2`;
      const segunda = await servico.complete(pedido(platform));
      if (!segunda.ok) throw new Error(`reautorizar ${platform}: ${segunda.error.message}`);
      const depois = await conexoes.findById(organizationId, id);
      resultados[platform] = {
        mesmoId: segunda.value.connectionId === id,
        status: depois?.status,
        versao: depois?.versaoDoToken,
      };
    }
    return resultados;
  } finally {
    globalThis.fetch = original;
  }
}

async function chaveContraOBanco(
  conexoes: ReturnType<typeof createConnectionRepository>,
  cofre: ReturnType<typeof novoCofre>,
) {
  const descobertas = createDiscoveredAccountRepository();
  const servico = createConnectionService(
    conexoes,
    {} as never,
    { record: async () => {} } as never,
    { findById: async () => null },
    cofre,
    { testar: async () => ({ ok: true as const, value: undefined }) } as never,
    descobertas,
  );
  const ator = { userId: '00000000-0000-4000-8000-000000000001', requestId: 'req', sourceIp: null };
  const pedido = (chave: string) => ({ organizationId, organizationSlug: 'cofre', papelDeQuemAge: 'owner' as const, platform: 'apify' as const, chave });
  const primeira = await servico.guardarChave(pedido('apify_api_chave-primeira-com-mais-de-vinte'), ator);
  const segunda = await servico.guardarChave(pedido('apify_api_chave-segunda-com-mais-de-vinte'), ator);
  if (!primeira.ok || !segunda.ok) throw new Error('guardarChave falhou');
  const registro = await createTokenRepository().carregar({ organizationId, connectionId: segunda.value.id });
  const decifrada = await cifra.decifrar(registro!.segredo, { connectionId: segunda.value.id, platform: 'apify', finalidade: 'segredo' });
  return { mesmoId: primeira.value.id === segunda.value.id, versao: segunda.value.versaoDoToken, decifrada, tipo: registro?.tipo };
}

comoPublico(main).catch((erro) => {
  console.error(erro);
  process.exit(1);
});
