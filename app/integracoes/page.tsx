import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Readiness } from '@/../app/_components/Readiness';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { encurtarEscopo } from '@/modules/audit/domain/auditView';
import { Marca } from '@/../app/_components/Marca';
import {
  PARA_QUE_SERVE,
  ROTULO_DA_PLATAFORMA,
  type Platform,
} from '@/modules/connections/domain/connection';
import { isConfigured, type ProviderCredentials } from '@/modules/connections/domain/oauth';
import { env } from '@/shared/config/env';
import { agruparPorAdministradora } from '@/modules/connections/domain/carteira';
import { Feedback } from '@/../app/_components/Feedback';
import { text, toActionState } from '@/shared/http/actions';
import { atorAtual } from '@/shared/http/ator';
import { requireContext } from '@/shared/http/currentOrganization';
import { canAdminister, canOperate } from '@/modules/identity/domain/user';
import { readinessOf } from '@/modules/connections/domain/connection';
import { checkbox } from '@/shared/http/actions';

export const dynamic = 'force-dynamic';

const pontoDoEstado: Record<string, string> = {
  active: 'dot--ok',
  expiring: 'dot--warn',
  degraded: 'dot--warn',
  revoked: 'dot--danger',
  reauth_pending: 'dot--warn',
};

const grantLabel: Record<string, string> = {
  mcc: 'MCC da organização',
  bm_partner: 'Parceria entre BMs',
  system_user: 'Usuário do sistema',
  oauth_user: 'OAuth direto',
};


async function contextoDeConexoes() {
  const contexto = await requireContext();
  if (contexto.clientIds !== null) redirect('/clientes');
  return contexto;
}

async function aceitarConvite(formData: FormData): Promise<void> {
  'use server';

  const contexto = await contextoDeConexoes();
  const organization = contexto.organization;
  const ator = await atorAtual();
  const voltar = (aviso: string): never =>
    redirect(`/integracoes?aviso=${encodeURIComponent(aviso)}`);

  if (!canAdminister(contexto.role)) {
    voltar('Só quem administra a organização pode alterar vínculos de conta.');
    return;
  }

  const conexaoDaConta = text(formData, 'conexaoDaConta');
  const conviteId = text(formData, 'conviteId');

  const conexoes = await modules().connections.listConnections(organization.id);
  if (!conexoes.some((item) => item.id === conexaoDaConta)) {
    voltar('Autorização não encontrada nesta organização.');
    return;
  }

  const pendentes = await modules().tasks.listRecentes(organization.id);
  const convite = pendentes.find(
    (tarefa) => tarefa.id === conviteId && tarefa.kind === 'mcc_invite' && tarefa.status === 'done',
  );

  if (!convite) {
    voltar('Convite não encontrado ou ainda não chegou ao Google.');
    return;
  }

  await modules().tasks.request({
    organizationId: organization.id,
    connectionId: conexaoDaConta,
    kind: 'mcc_accept',
    managerExternalId: convite.managerExternalId,
    targetExternalId: convite.targetExternalId,
    requestedBy: ator.userId,
  });

  await modules().audit.record({
    organizationId: organization.id,
    actorType: 'user',
    actorId: ator.userId,
    action: 'mcc.accept_requested',
    targetType: 'connection',
    targetId: conexaoDaConta,
    requestId: ator.requestId,
    sourceIp: ator.sourceIp,
    metadata: {
      administradora: convite.managerExternalId,
      conta: convite.targetExternalId,
      conviteId: convite.id,
    },
  });

  voltar('Aceite enfileirado. Ele usa a credencial da conta convidada, como o Google exige.');
}


async function convidarParaMcc(formData: FormData): Promise<void> {
  'use server';

  const contexto = await contextoDeConexoes();
  const ator = await atorAtual();
  const voltar = (aviso: string): never =>
    redirect(`/integracoes?aviso=${encodeURIComponent(aviso)}`);

  if (!canAdminister(contexto.role)) {
    voltar('Só quem administra a organização pode convidar contas para a MCC.');
    return;
  }

  const administradora = text(formData, 'administradora');
  const alcancaveis = await modules().discoveredAccounts.listAll(contexto.organization.id);

  const conta = alcancaveis.find((item) => item.id === text(formData, 'contaId'));
  if (!conta) {
    voltar('Conta não encontrada nesta organização.');
    return;
  }

  const conexaoDaMcc = alcancaveis.find(
    (item) => item.managerExternalId === administradora && item.externalId !== administradora,
  )?.connectionId;

  if (!conexaoDaMcc) {
    voltar('Não há autorização que alcance essa administradora.');
    return;
  }

  await modules().tasks.request({
    organizationId: contexto.organization.id,
    connectionId: conexaoDaMcc,
    kind: 'mcc_invite',
    managerExternalId: administradora,
    targetExternalId: conta.externalId,
    requestedBy: ator.userId,
  });

  await modules().audit.record({
    organizationId: contexto.organization.id,
    actorType: 'user',
    actorId: ator.userId,
    action: 'mcc.invite_requested',
    targetType: 'connection',
    targetId: conexaoDaMcc,
    requestId: ator.requestId,
    sourceIp: ator.sourceIp,
    metadata: { administradora, conta: conta.externalId },
  });

  voltar(`Convite enviado para ${conta.externalId}. O dono precisa aceitar.`);
}


async function vincularAlcancavel(formData: FormData): Promise<void> {
  'use server';

  const contexto = await contextoDeConexoes();
  const organization = contexto.organization;
  const ator = await atorAtual();
  const voltar = (aviso: string): never =>
    redirect(`/integracoes?aviso=${encodeURIComponent(aviso)}`);

  if (!canOperate(contexto.role)) {
    voltar('Seu papel não permite vincular contas.');
    return;
  }

  const descobertas = await modules().discoveredAccounts.listPending(organization.id);
  const escolhida = descobertas.find((conta) => conta.id === text(formData, 'contaId'));
  if (!escolhida) {
    voltar('Conta não encontrada entre as que você alcança.');
    return;
  }

  const clientId = text(formData, 'clientId');
  const dono = (await modules().clients.list(organization.id)).find(
    (cliente) => cliente.id === clientId && cliente.status === 'active',
  );
  if (!dono) {
    voltar('Escolha um cliente ativo desta organização. É ele que dá dono ao número.');
    return;
  }

  const vinculada = await modules().connections.linkAccount(
    {
      organizationId: organization.id,
      clientId,
      connectionId: escolhida.connectionId,
      platform: escolhida.platform,
      externalId: escolhida.externalId,
      name: escolhida.name,
      accountGroup: 'Principal',
      currency: escolhida.currency,
      timezone: escolhida.timezone,
      syncEnabled: !checkbox(formData, 'semColeta'),
    },
    ator,
  );

  if (!vinculada.ok) {
    voltar(toActionState(vinculada.error).error ?? 'Falha ao vincular a conta.');
    return;
  }

  await modules().discoveredAccounts.markLinked(organization.id, escolhida.id, vinculada.value.id);
  voltar(`${escolhida.name} vinculada.`);
}

async function guardarChave(formData: FormData): Promise<void> {
  'use server';

  const contexto = await contextoDeConexoes();
  const ator = await atorAtual();
  const voltar = (aviso: string): never =>
    redirect(`/integracoes?aviso=${encodeURIComponent(aviso)}`);

  const resultado = await modules().connections.guardarChave(
    {
      organizationId: contexto.organization.id,
      organizationSlug: contexto.organization.slug,
      papelDeQuemAge: contexto.role,
      platform: 'apify',
      chave: text(formData, 'chave'),
    },
    ator,
  );

  if (!resultado.ok) voltar(toActionState(resultado.error).error ?? 'Não deu para guardar a chave.');
  voltar('Chave guardada no cofre. O banco ficou só com a referência.');
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  const organization = ctx.organization;
  const agencia = organization.type === 'agency';
  const podeVincular = canOperate(ctx.role);

  const { aviso } = await searchParams;

  const [connections, accounts, alcancaveis, tarefas, clientes] = await Promise.all([
    modules().connections.listConnections(organization.id),
    modules().connections.listAccounts(organization.id),
    modules().discoveredAccounts.listAll(organization.id),
    modules().tasks.listRecentes(organization.id),
    modules().clients.list(organization.id),
  ]);

  const convitesEnviados = tarefas.filter((tarefa) => tarefa.kind === 'mcc_invite');
  const aceitesPedidos = new Set(
    tarefas.filter((tarefa) => tarefa.kind === 'mcc_accept').map((tarefa) => tarefa.targetExternalId),
  );

  const administradoras = agruparPorAdministradora(alcancaveis).filter(
    (caminho) => caminho.administradora !== null,
  );
  const vinculadas = new Set(accounts.map((conta) => conta.externalId));
  const administradorasConhecidas = new Set(
    administradoras.map((caminho) => caminho.administradora as string),
  );
  const porConexao = new Map(connections.map((conexao) => [conexao.id, conexao]));

  const paraConectar = alcancaveis.filter(
    (conta) => !vinculadas.has(conta.externalId) && !administradorasConhecidas.has(conta.externalId),
  );
  const clientesAtivos = clientes.filter((cliente) => cliente.status === 'active');
  const clienteUnico = clientesAtivos.length === 1 ? clientesAtivos[0]!.id : '';
  const substantivo = agencia ? 'cliente' : 'negócio';

  const config = env();
  const credenciais: Record<Platform, ProviderCredentials> = {
    google: {
      clientId: config.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    },
    meta: {
      clientId: config.META_APP_ID,
      clientSecret: config.META_APP_SECRET,
      configId: config.META_LOGIN_CONFIG_ID,
    },
    rdstation: {
      clientId: config.RDSTATION_CLIENT_ID,
      clientSecret: config.RDSTATION_CLIENT_SECRET,
    },
    apify: { clientId: 'n/a', clientSecret: 'n/a' },
  };

  const conexoesPor = (platform: Platform) =>
    connections.filter((conexao) => conexao.platform === platform);

  return (
    <Shell title="Conexões" organization={organization} active="/integracoes">
      <div className="page__head">
        <div>
          <div className="page__title">Conexões</div>
          <div className="page__sub">
            Um card por fornecedor. O segredo vive cifrado no cofre do n8n; aqui ficam só o metadado
            e uma referência.
          </div>
        </div>
      </div>

      <Feedback message={aviso} tone="info" />

      <section className="fornecedor">
        <header className="fornecedor__head">
          <span className="fornecedor__marca">
            <Marca platform="google" />
          </span>
          <span className="fornecedor__quem">
            <span className="fornecedor__nome">{ROTULO_DA_PLATAFORMA.google}</span>
            <span className="fornecedor__sub">{PARA_QUE_SERVE.google}</span>
          </span>
          <span className="fornecedor__estado">
            {conexoesPor('google').map((conexao) => (
              <Link key={conexao.id} className="autorizacao" href={`/integracoes/${conexao.id}`}>
                <span className={`dot ${pontoDoEstado[conexao.status] ?? ''}`} />
                <span className="autorizacao__quem">
                  {conexao.accountEmail ?? conexao.externalId}
                </span>
              </Link>
            ))}
            <Link className="btn btn--compacto" href="/api/oauth/google/start?returnTo=/integracoes">
              {conexoesPor('google').length > 0 ? 'Autorizar outra conta' : 'Autorizar'}
            </Link>
          </span>
        </header>

        <div className="fornecedor__corpo">

      <div className="card">
        <div className="card__head">
          <span className="card__title">Administradoras</span>
          <span className="card__sub">
            {administradoras.length === 0
              ? 'nenhuma MCC no caminho das suas autorizações'
              : `${administradoras.length} MCC · não veiculam campanha, abrem acesso`}
          </span>
        </div>

        {administradoras.length === 0 ? (
          <div className="empty">
            Autorize com a conta que administra sua MCC para enxergá-la aqui.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Administradora</th>
                  <th className="num">Contas sob ela</th>
                  <th className="num">Vinculadas</th>
                  <th>Autorização que alcança</th>
                </tr>
              </thead>
              <tbody>
                {administradoras.map((caminho) => {
                  const conexao = porConexao.get(caminho.contas[0]?.connectionId ?? '');
                  return (
                    <tr key={caminho.administradora}>
                      <td>
                        <span className="mono strong">{caminho.administradora}</span>
                      </td>
                      <td className="num">{caminho.contas.length}</td>
                      <td className="num">{caminho.vinculadas}</td>
                      <td className="subtle">
                        {conexao ? (
                          <Link href={`/integracoes/${conexao.id}`}>
                            {conexao.accountEmail ?? conexao.externalId}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Contas</span>
          <span className="card__sub">{accounts.length} vinculada(s)</span>
        </div>
        {accounts.length === 0 ? (
          <div className="empty">Nenhuma conta vinculada ainda.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>{agencia ? 'Cliente' : 'Negócio'}</th>
                  <th>Plataforma</th>
                  <th>Coleta</th>
                  <th>Última coleta</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((conta) => (
                  <tr key={conta.id}>
                    <td>
                      <div className="strong">{conta.name}</div>
                      <div className="mono subtle">{conta.externalId}</div>
                    </td>
                    <td>
                      <Link href={`/clientes/${conta.clientId}`}>{conta.clientName}</Link>
                    </td>
                    <td className="muted">{conta.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}</td>
                    <td>
                      <span className={`pill ${conta.syncEnabled ? 'pill--ok' : ''}`}>
                        {conta.syncEnabled ? 'Ligada' : 'Pausada'}
                      </span>
                    </td>
                    <td className="muted">
                      {conta.lastSyncAt ? conta.lastSyncAt.toLocaleString('pt-BR') : 'nunca'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Conectar conta</span>
          <span className="card__sub">
            {paraConectar.length === 0
              ? 'tudo o que você alcança já está vinculado'
              : `${paraConectar.length} conta(s) ao seu alcance, ainda sem ${substantivo}`}
          </span>
        </div>

        {paraConectar.length === 0 ? (
          <div className="empty">
            As contas aparecem aqui depois que você autoriza a plataforma. A Orla só enxerga o que o
            Google ou a Meta devolvem.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Onde está</th>
                  <th>{agencia ? 'Cliente' : 'Negócio'}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {paraConectar.map((conta) => {
                  const sobMcc =
                    conta.managerExternalId && conta.managerExternalId !== conta.externalId
                      ? conta.managerExternalId
                      : null;
                  const convite = convitesEnviados.find(
                    (item) => item.targetExternalId === conta.externalId,
                  );
                  const mccDisponivel = administradoras[0]?.administradora ?? null;

                  return (
                    <tr key={conta.id}>
                      <td>
                        <div className="strong">{conta.name}</div>
                        <div className="mono subtle">
                          {conta.externalId} · {conta.currency}
                        </div>
                        {conta.inactive ? (
                          <span className="pill pill--warn">inativa na plataforma</span>
                        ) : null}
                      </td>
                      <td>
                        {sobMcc ? (
                          <span className="mono subtle">sob {sobMcc}</span>
                        ) : convite && aceitesPedidos.has(conta.externalId) ? (
                          <span className="subtle">aceite enfileirado</span>
                        ) : convite && convite.status === 'done' ? (
                          <form className="form--inline" action={aceitarConvite}>
                            <input type="hidden" name="conviteId" value={convite.id} />
                            <select className="select select--compacto" name="conexaoDaConta" required>
                              <option value="">autorização da conta…</option>
                              {connections.map((conexao) => (
                                <option key={conexao.id} value={conexao.id}>
                                  {conexao.accountEmail ?? conexao.externalId}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn--compacto" type="submit">
                              Aceitar convite
                            </button>
                          </form>
                        ) : convite ? (
                          <span className="subtle">convite a caminho do Google</span>
                        ) : agencia && mccDisponivel && canAdminister(ctx.role) ? (
                          <form action={convidarParaMcc}>
                            <input type="hidden" name="contaId" value={conta.id} />
                            <input type="hidden" name="administradora" value={mccDisponivel} />
                            <button className="btn btn--compacto" type="submit">
                              Convidar para a MCC
                            </button>
                          </form>
                        ) : (
                          <span className="subtle">acesso direto</span>
                        )}
                      </td>
                      <td colSpan={2}>
                        {!podeVincular ? (
                          <span className="subtle">seu papel não vincula contas</span>
                        ) : clientesAtivos.length === 0 ? (
                          <span className="row">
                            <span className="subtle">
                              toda conta tem dono: cadastre um {substantivo} para vincular
                            </span>
                            <Link className="btn btn--compacto" href="/clientes/novo">
                              Cadastrar {substantivo}
                            </Link>
                          </span>
                        ) : (
                          <form className="form--inline" action={vincularAlcancavel}>
                            <input type="hidden" name="contaId" value={conta.id} />
                            <select
                              className="select select--compacto"
                              name="clientId"
                              defaultValue={clienteUnico}
                              required
                              aria-label={`${agencia ? 'Cliente' : 'Negócio'} dono de ${conta.name}`}
                            >
                              <option value="">escolher {substantivo}…</option>
                              {clientesAtivos.map((cliente) => (
                                <option key={cliente.id} value={cliente.id}>
                                  {cliente.name}
                                </option>
                              ))}
                            </select>
                            <label className="checkline">
                              <input type="checkbox" name="semColeta" />
                              sem coletar agora
                            </label>
                            <button className="btn btn--primary btn--compacto" type="submit">
                              Vincular
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </div>
      </section>

      {(['meta', 'rdstation'] as const).map((plataforma) => {
        const conectadas = conexoesPor(plataforma);
        const pronto = isConfigured(credenciais[plataforma], plataforma);

        return (
          <section className="fornecedor" key={plataforma}>
            <header className="fornecedor__head">
              <span className="fornecedor__marca">
                <Marca platform={plataforma} />
              </span>
              <span className="fornecedor__quem">
                <span className="fornecedor__nome">{ROTULO_DA_PLATAFORMA[plataforma]}</span>
                <span className="fornecedor__sub">{PARA_QUE_SERVE[plataforma]}</span>
              </span>
              <span className="fornecedor__estado">
                {conectadas.map((conexao) => (
                  <Link key={conexao.id} className="autorizacao" href={`/integracoes/${conexao.id}`}>
                    <span className={`dot ${pontoDoEstado[conexao.status] ?? ''}`} />
                    <span className="autorizacao__quem">
                      {conexao.accountEmail ?? conexao.externalId}
                    </span>
                  </Link>
                ))}
                {pronto ? (
                  <Link
                    className="btn btn--compacto"
                    href={`/api/oauth/${plataforma}/start?returnTo=/integracoes`}
                  >
                    {conectadas.length > 0 ? 'Autorizar outra conta' : 'Autorizar'}
                  </Link>
                ) : (
                  <span className="pill pill--warn">falta configurar o app</span>
                )}
              </span>
            </header>

            {plataforma === 'meta' ? (
              <div className="fornecedor__corpo">
                <div className="aviso">
                  Cada cliente autoriza com a conta de Facebook dele, e as contas de anúncio que
                  aquela pessoa administra passam a ser alcançáveis. Para funcionar com quem não tem
                  papel no app, a Meta exige o app em modo Live com App Review aprovado para
                  <span className="mono"> ads_read</span>,<span className="mono"> ads_management</span>,
                  <span className="mono"> business_management</span> e
                  <span className="mono"> leads_retrieval</span>.
                </div>
              </div>
            ) : null}
          </section>
        );
      })}

      <section className="fornecedor">
        <header className="fornecedor__head">
          <span className="fornecedor__marca">
            <Marca platform="apify" />
          </span>
          <span className="fornecedor__quem">
            <span className="fornecedor__nome">{ROTULO_DA_PLATAFORMA.apify}</span>
            <span className="fornecedor__sub">{PARA_QUE_SERVE.apify}</span>
          </span>
          <span className="fornecedor__estado">
            {conexoesPor('apify').map((conexao) => (
              <Link key={conexao.id} className="autorizacao" href={`/integracoes/${conexao.id}`}>
                <span className={`dot ${pontoDoEstado[conexao.status] ?? ''}`} />
                <span className="autorizacao__quem mono">{conexao.externalId}</span>
              </Link>
            ))}
          </span>
        </header>

        {canAdminister(ctx.role) ? (
          <form className="form--linha" action={guardarChave}>
            <label className="field">
              <span className="field__label">Chave de API</span>
              <input
                className="input"
                type="password"
                name="chave"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="apify_api_..."
              />
              <span className="field__hint">
                A chave vai direto para o cofre do n8n. Nosso banco guarda só a referência e as
                quatro primeiras e últimas letras, para você reconhecê-la depois.
              </span>
            </label>
            <button className="btn btn--primary" type="submit">
              Guardar no cofre
            </button>
          </form>
        ) : (
          <div className="fornecedor__corpo">
            <div className="empty">Só quem administra a organização pode guardar uma chave.</div>
          </div>
        )}
      </section>
    </Shell>
  );
}
