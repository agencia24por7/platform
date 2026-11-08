import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Readiness } from '@/../app/_components/Readiness';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { encurtarEscopo } from '@/modules/audit/domain/auditView';
import { agruparPorAdministradora } from '@/modules/connections/domain/carteira';
import { Feedback } from '@/../app/_components/Feedback';
import { text } from '@/shared/http/actions';
import { atorAtual } from '@/shared/http/ator';
import { currentOrganization, requireContext } from '@/shared/http/currentOrganization';
import { canAdminister } from '@/modules/identity/domain/user';
import { readinessOf } from '@/modules/connections/domain/connection';

export const dynamic = 'force-dynamic';

const statusTone: Record<string, string> = {
  active: 'pill--ok',
  expiring: 'pill--warn',
  degraded: 'pill--warn',
  revoked: 'pill--danger',
  reauth_pending: 'pill--warn',
};

const grantLabel: Record<string, string> = {
  mcc: 'MCC da organização',
  bm_partner: 'Parceria entre BMs',
  system_user: 'Usuário do sistema',
  oauth_user: 'OAuth direto',
};


async function aceitarConvite(formData: FormData): Promise<void> {
  'use server';

  const contexto = await requireContext();
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

  const contexto = await requireContext();
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

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const { aviso } = await searchParams;

  const [connections, accounts, alcancaveis, tarefas] = await Promise.all([
    modules().connections.listConnections(organization.id),
    modules().connections.listAccounts(organization.id),
    modules().discoveredAccounts.listAll(organization.id),
    modules().tasks.listRecentes(organization.id),
  ]);

  const convitesEnviados = tarefas.filter((tarefa) => tarefa.kind === 'mcc_invite');
  const aceitesPedidos = new Set(
    tarefas.filter((tarefa) => tarefa.kind === 'mcc_accept').map((tarefa) => tarefa.targetExternalId),
  );

  const caminhos = agruparPorAdministradora(alcancaveis);
  const administradoras = caminhos.filter((caminho) => caminho.administradora !== null);
  const foraDeMcc = new Set(
    administradoras.flatMap((caminho) => caminho.contas.map((conta) => conta.externalId)),
  );
  const porExternalId = new Map(accounts.map((conta) => [conta.externalId, conta]));

  return (
    <Shell title="Contas e conexões" organization={organization} active="/integracoes">
      <div className="page__head">
        <div>
          <div className="page__title">Contas e conexões</div>
          <div className="page__sub">
            A autorização guarda apenas metadado e uma referência de credencial. O segredo vive no n8n,
            cifrado, e nunca passa por aqui.
          </div>
        </div>
      </div>

      <Readiness connections={connections.length} linkedAccounts={accounts.length} />


      <Feedback message={aviso} tone="info" />

      {convitesEnviados.length > 0 ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">Convites enviados pela sua MCC</span>
            <span className="card__sub">
              O Google exige que o aceite venha da conta convidada, não da administradora
            </span>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Conta convidada</th>
                  <th>Administradora</th>
                  <th>Estado do convite</th>
                  <th>Resultado</th>
                  <th>Aceitar pela tria</th>
                </tr>
              </thead>
              <tbody>
                {convitesEnviados.map((convite) => {
                  const jaPedido = aceitesPedidos.has(convite.targetExternalId);
                  const podeAceitar = convite.status === 'done' && !jaPedido;

                  return (
                    <tr key={convite.id}>
                      <td className="mono">{convite.targetExternalId}</td>
                      <td className="mono subtle">{convite.managerExternalId}</td>
                      <td>
                        <span
                          className={`pill ${
                            convite.status === 'done'
                              ? 'pill--ok'
                              : convite.status === 'failed'
                                ? 'pill--danger'
                                : 'pill--info'
                          }`}
                        >
                          {convite.status === 'done' ? 'aguardando aceite' : convite.status}
                        </span>
                      </td>
                      <td className="subtle">{convite.outcome ?? '—'}</td>
                      <td>
                        {jaPedido ? (
                          <span className="subtle">aceite enfileirado</span>
                        ) : podeAceitar ? (
                          <form action={aceitarConvite} className="row">
                            <input type="hidden" name="conviteId" value={convite.id} />
                            <select className="select" name="conexaoDaConta" required>
                              <option value="">autorização da conta convidada…</option>
                              {connections.map((conexao) => (
                                <option key={conexao.id} value={conexao.id}>
                                  {conexao.accountEmail ?? conexao.externalId}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn--primary btn--pill" type="submit">
                              Aceitar
                            </button>
                          </form>
                        ) : (
                          <span className="subtle">o convite precisa chegar ao Google primeiro</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card__foot">
            Só aparece aqui a conta cujo dono já autorizou a tria. Sem essa autorização, o aceite
            precisa ser feito no Google Ads dele.
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card__head">
          <span className="card__title">Autorizações</span>
          <span className="card__sub">{connections.length} registrada(s)</span>
        </div>
        {connections.length === 0 ? (
          <div className="empty">Nenhuma autorização. Crie uma ao conectar a primeira conta.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Autorização</th>
                  <th>Plataforma</th>
                  <th>Conta que concedeu</th>
                  <th>Concedida em</th>
                  <th>Caminho</th>
                  <th>Escopos</th>
                  <th>Credencial</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection) => (
                  <tr key={connection.id}>
                    <td>
                      <Link className="strong" href={`/integracoes/${connection.id}`}>
                        {connection.label}
                      </Link>
                      <div className="mono subtle">{connection.externalId}</div>
                    </td>
                    <td>{connection.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}</td>
                    <td>
                      {connection.accountEmail ?? <span className="subtle">não informado</span>}
                    </td>
                    <td className="nowrap">
                      <div>{connection.authorizedAt.toLocaleDateString('pt-BR')}</div>
                      <div className="subtle">
                        {connection.authorizedAt.toLocaleTimeString('pt-BR')}
                      </div>
                    </td>
                    <td className="muted">{grantLabel[connection.grantType]}</td>
                    <td>
                      <div className="fichas">
                        {connection.scopes.map((scope) => (
                          <span key={scope} className="ficha" title={scope}>
                            {encurtarEscopo(scope)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="mono">
                      {readinessOf(connection).collectable ? 'cofre · ok' : 'sem credencial'}
                    </td>
                    <td>
                      <span className={`pill ${statusTone[connection.status] ?? ''}`}>
                        <span className="dot" />
                        {connection.status}
                      </span>
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
          <span className="card__title">Administradoras conectadas</span>
          <span className="card__sub">
            {administradoras.length === 0
              ? 'nenhuma MCC no caminho das suas autorizações'
              : `${administradoras.length} MCC · não veiculam campanha, abrem acesso`}
          </span>
        </div>

        {administradoras.length === 0 ? (
          <div className="empty">
            Nenhuma administradora. Autorize com a conta que administra sua MCC para enxergá-la aqui.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Administradora</th>
                  <th className="num">Contas sob ela</th>
                  <th className="num">Vinculadas a cliente</th>
                  <th>Autorização que alcança</th>
                </tr>
              </thead>
              <tbody>
                {administradoras.map((caminho) => {
                  const primeira = caminho.contas[0];
                  const conexao = connections.find((item) => item.id === primeira?.connectionId);

                  return (
                    <tr key={caminho.administradora}>
                      <td>
                        <span className="pill pill--info">MCC</span>
                        <div className="mono strong">{caminho.administradora}</div>
                      </td>
                      <td className="num">{caminho.contas.length}</td>
                      <td className="num">{caminho.vinculadas}</td>
                      <td className="subtle">
                        {conexao?.accountEmail ?? conexao?.externalId ?? '—'}
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
          <span className="card__title">Contas que você alcança</span>
          <span className="card__sub">
            {alcancaveis.length} conta(s) · {foraDeMcc.size} sob administradora
          </span>
        </div>

        {alcancaveis.length === 0 ? (
          <div className="empty">
            Nenhuma conta ainda. Autorize uma plataforma para a Orla enxergar o que você administra.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Identificador</th>
                  <th>Moeda</th>
                  <th>Cliente</th>
                  <th>Administradora</th>
                </tr>
              </thead>
              <tbody>
                {alcancaveis.map((conta) => {
                  const vinculada = porExternalId.get(conta.externalId);
                  const sobMcc =
                    conta.managerExternalId && conta.managerExternalId !== conta.externalId
                      ? conta.managerExternalId
                      : null;
                  const mccDisponivel = administradoras[0]?.administradora ?? null;
                  const convitePedido = convitesEnviados.some(
                    (convite) => convite.targetExternalId === conta.externalId,
                  );

                  return (
                    <tr key={conta.id}>
                      <td>
                        <div className="strong">{conta.name}</div>
                        {conta.inactive ? (
                          <span className="pill pill--warn">inativa na plataforma</span>
                        ) : null}
                      </td>
                      <td className="mono">{conta.externalId}</td>
                      <td>{conta.currency}</td>
                      <td>
                        {vinculada ? (
                          vinculada.clientName
                        ) : (
                          <span className="subtle">nenhum cliente</span>
                        )}
                      </td>
                      <td>
                        {sobMcc ? (
                          <span className="mono">{sobMcc}</span>
                        ) : convitePedido ? (
                          <span className="subtle">convite enviado</span>
                        ) : mccDisponivel ? (
                          <form action={convidarParaMcc}>
                            <input type="hidden" name="contaId" value={conta.id} />
                            <input type="hidden" name="administradora" value={mccDisponivel} />
                            <button className="btn btn--pill" type="submit">
                              Convidar para a MCC
                            </button>
                          </form>
                        ) : (
                          <span className="subtle">acesso direto</span>
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
          <span className="card__title">Contas vinculadas</span>
          <span className="card__sub">{accounts.length} conta(s)</span>
        </div>
        {accounts.length === 0 ? (
          <div className="empty">Nenhuma conta vinculada.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Cliente</th>
                  <th>Plataforma</th>
                  <th>Coleta</th>
                  <th>Última coleta</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="strong">{account.name}</div>
                      <div className="mono subtle">{account.externalId}</div>
                    </td>
                    <td className="muted">{account.clientName}</td>
                    <td>{account.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}</td>
                    <td>
                      <span className={`pill ${account.syncEnabled ? 'pill--ok' : ''}`}>
                        {account.syncEnabled ? 'Ligada' : 'Desligada'}
                      </span>
                    </td>
                    <td className="muted">
                      {account.lastSyncAt ? account.lastSyncAt.toLocaleString('pt-BR') : 'nunca'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
