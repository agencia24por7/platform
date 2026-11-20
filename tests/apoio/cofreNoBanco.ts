import { randomUUID } from 'node:crypto';
import { createConnectionRepository } from '@/modules/connections/infrastructure/connectionRepository';
import { createCofreDeTokens } from '@/modules/tokens/application/cofreDeTokens';
import { createChaveMestraLocal } from '@/modules/tokens/infrastructure/chavesMestras';
import { createCifraEnvelope } from '@/modules/tokens/infrastructure/envelope';
import { createMarcadorDeReautorizacao, createTokenRepository } from '@/modules/tokens/infrastructure/tokenRepository';
import type { ProvedorDeToken } from '@/modules/tokens/application/portas';
import { sql } from '@/shared/db/client';
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

  console.log(
    JSON.stringify({
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

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
