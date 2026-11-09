import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { encurtarEscopo } from '@/modules/audit/domain/auditView';
import { missingScopes, readinessOf } from '@/modules/connections/domain/connection';
import { Feedback } from '@/../app/_components/Feedback';
import { MOTIVO_DO_CONVITE, decidirConvite } from '@/modules/connections/domain/convite';
import { text } from '@/shared/http/actions';
import { atorAtual } from '@/shared/http/ator';
import { requireContext } from '@/shared/http/currentOrganization';
import { canAdminister } from '@/modules/identity/domain/user';

export const dynamic = 'force-dynamic';

const PLATAFORMA = {
  google: { nome: 'Google Ads', marca: '/marcas/google-ads.png' },
  meta: { nome: 'Meta Ads', marca: '/marcas/meta.png' },
} as const;

const CAMINHO: Record<string, string> = {
  mcc: 'Conta de administrador (MCC)',
  bm_partner: 'Business Manager como parceiro',
  system_user: 'Usuário de sistema',
  oauth_user: 'OAuth direto',
};

const ESTADO_CONTA: Record<string, { rotulo: string; tom: string }> = {
  discovered: { rotulo: 'disponível', tom: 'pill--info' },
  linked: { rotulo: 'vinculada', tom: 'pill--ok' },
  ignored: { rotulo: 'ignorada', tom: '' },
  lost: { rotulo: 'sumiu da plataforma', tom: 'pill--warn' },
};


async function convidarConta(formData: FormData): Promise<void> {
  'use server';

  const contexto = await requireContext();
  const organization = contexto.organization;
  const ator = await atorAtual();
  const connectionId = text(formData, 'connectionId');
  const voltar = (aviso: string): never =>
    redirect(`/integracoes/${connectionId}?aviso=${encodeURIComponent(aviso)}`);

  if (!canAdminister(contexto.role)) {
    voltar('Só quem administra a organização pode convidar contas para a MCC.');
    return;
  }

  const alcancaveis = await modules().discoveredAccounts.listByConnection(
    organization.id,
    connectionId,
  );

  const administradora =
    alcancaveis.find(
      (conta) => conta.managerExternalId && conta.managerExternalId !== conta.externalId,
    )?.managerExternalId ?? null;

  const decisao = decidirConvite({
    bruto: text(formData, 'conta'),
    administradora,
    jaAlcancadas: alcancaveis.map((conta) => conta.externalId),
  });

  if (!decisao.ok) {
    voltar(MOTIVO_DO_CONVITE[decisao.motivo]);
    return;
  }

  await modules().tasks.request({
    organizationId: organization.id,
    connectionId,
    kind: 'mcc_invite',
    managerExternalId: administradora!,
    targetExternalId: decisao.alvo,
    requestedBy: ator.userId,
  });

  await modules().audit.record({
    organizationId: organization.id,
    actorType: 'user',
    actorId: ator.userId,
    action: 'mcc.invite_requested',
    targetType: 'connection',
    targetId: connectionId,
    requestId: ator.requestId,
    sourceIp: ator.sourceIp,
    metadata: { administradora, conta: decisao.alvo },
  });

  redirect(`/integracoes/${connectionId}?aviso=${encodeURIComponent('Convite enviado para a fila.')}`);
}

export default async function DetalheAutorizacao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string }>;
}) {
  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  const organization = ctx.organization;

  const { id } = await params;
  const { aviso } = await searchParams;

  const conexoes = await modules().connections.listConnections(organization.id);
  const conexao = conexoes.find((item) => item.id === id);
  if (!conexao) notFound();

  const [liberadas, vinculadas, eventos, tarefas] = await Promise.all([
    modules().discoveredAccounts.listByConnection(organization.id, conexao.id),
    modules().connections.listAccounts(organization.id),
    modules().audit.search(organization.id, { targetId: conexao.id, limit: 20 }),
    modules().tasks.listByConnection(organization.id, conexao.id),
  ]);

  const administradora =
    liberadas.find((conta) => conta.managerExternalId && conta.managerExternalId !== conta.externalId)
      ?.managerExternalId ?? null;

  const prontidao = readinessOf(conexao);
  const faltando = missingScopes(conexao.platform, conexao.scopes);
  const plataforma = PLATAFORMA[conexao.platform];
  const autorizacao = eventos.find((evento) => evento.action === 'connection.authorize');
  const varredura = (autorizacao?.metadata?.['varredura'] ?? null) as {
    raizes?: number;
    brutas?: number;
    administradoras?: number;
    recusadas?: number;
  } | null;
  const recusa = (autorizacao?.metadata?.['discoveryFailure'] ?? null) as string | null;
  const porExternalId = new Map(vinculadas.map((conta) => [conta.externalId, conta]));

  return (
    <Shell
      title={`Autorização · ${plataforma.nome}`}
      organization={organization}
      active="/integracoes"
    >
      <div className="page__head">
        <div>
          <h1 className="page__title">{conexao.label}</h1>
          <p className="page__sub">
            Concedida em {conexao.authorizedAt.toLocaleString('pt-BR')} ·{' '}
            {CAMINHO[conexao.grantType] ?? conexao.grantType}
          </p>
        </div>
        <div className="page__actions">
          <Link className="btn btn--pill" href="/integracoes">
            Voltar
          </Link>
        </div>
      </div>

      {!prontidao.collectable ? (
        <div className="alert alert--warn">
          <strong>Esta autorização não coleta.</strong> {prontidao.reason}
        </div>
      ) : null}

      <div className="card">
        <div className="card__head">
          <span className="card__title">Identidade</span>
          <span className={`pill ${prontidao.collectable ? 'pill--ok' : 'pill--warn'}`} style={{ marginLeft: 'auto' }}>
            <span className="dot" />
            {conexao.status}
          </span>
        </div>
        <div className="card__body">
          <div className="fatos">
            <div className="fatos__item">
              <span className="fatos__rotulo">Plataforma</span>
              <span className="com-marca">
                <img src={plataforma.marca} alt="" width={16} height={16} />
                {plataforma.nome}
              </span>
            </div>
            <div className="fatos__item">
              <span className="fatos__rotulo">Conta que concedeu</span>
              <span>{conexao.accountEmail ?? <span className="subtle">não informado</span>}</span>
            </div>
            <div className="fatos__item">
              <span className="fatos__rotulo">Id na plataforma</span>
              <span className="mono">{conexao.externalId}</span>
            </div>
            <div className="fatos__item">
              <span className="fatos__rotulo">Credencial</span>
              <span>{prontidao.collectable ? 'guardada no cofre' : 'ausente'}</span>
            </div>
            {conexao.expiresAt ? (
              <div className="fatos__item">
                <span className="fatos__rotulo">Expira</span>
                <span>{conexao.expiresAt.toLocaleString('pt-BR')}</span>
              </div>
            ) : null}
          </div>

          <details className="disclosure">
            <summary>Quem autorizou</summary>
            <div>
              {autorizacao ? (
                <div className="fatos">
                  <div className="fatos__item">
                    <span className="fatos__rotulo">Pessoa</span>
                    <span className="mono" title={autorizacao.actorId ?? ''}>
                      {autorizacao.actorId ? autorizacao.actorId.slice(0, 8) : '—'}
                    </span>
                  </div>
                  <div className="fatos__item">
                    <span className="fatos__rotulo">Quando</span>
                    <span>{autorizacao.occurredAt.toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="fatos__item">
                    <span className="fatos__rotulo">Origem</span>
                    <span className="mono">{autorizacao.sourceIp ?? '—'}</span>
                  </div>
                  <div className="fatos__item">
                    <span className="fatos__rotulo">Requisição</span>
                    <span className="mono" title={autorizacao.requestId ?? ''}>
                      {autorizacao.requestId ? autorizacao.requestId.slice(0, 8) : '—'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="subtle">
                  Sem evento de auditoria para esta autorização. Ela é anterior ao registro de autor.
                </p>
              )}
              <Link className="quiet-link" href="/auditoria?evento=connection.authorize" style={{ marginTop: 10, display: 'inline-block' }}>
                ver na trilha de auditoria →
              </Link>
            </div>
          </details>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Permissões concedidas</span>
          <span className="card__sub">{conexao.scopes.length}</span>
        </div>
        <div className="card__body">
          <div className="fichas">
            {conexao.scopes.map((scope) => (
              <span key={scope} className="ficha" title={scope}>
                {encurtarEscopo(scope)}
              </span>
            ))}
          </div>
          {faltando.length > 0 ? (
            <p className="subtle">
              Falta o escopo obrigatório <strong>{faltando.join(', ')}</strong>. Reautorize para
              coletar.
            </p>
          ) : (
            <p className="subtle">Os escopos obrigatórios desta plataforma estão presentes.</p>
          )}
        </div>
      </div>


      <Feedback message={aviso} tone="info" />

      {administradora ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">Convidar conta para a MCC {administradora}</span>
            <span className="card__sub">
              O convite sai da sua administradora; o dono da conta precisa aceitar no Google Ads dele
            </span>
          </div>
          <form action={convidarConta} className="card__body">
            <input type="hidden" name="connectionId" value={conexao.id} />
            <div className="field">
              <label className="field__label" htmlFor="conta">
                Identificador da conta
              </label>
              <input
                className="input"
                id="conta"
                name="conta"
                placeholder="123-456-7890"
                required
                inputMode="numeric"
              />
              <span className="field__hint">
                A Orla não cria contas de anúncio. Ela apenas convida uma conta que já existe.
              </span>
            </div>
            <div className="page__actions">
              <button className="btn btn--primary btn--pill" type="submit">
                Enviar convite
              </button>
            </div>
          </form>

          {tarefas.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Conta convidada</th>
                    <th>Pedido em</th>
                    <th>Tentativas</th>
                    <th>Estado</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {tarefas.map((tarefa) => (
                    <tr key={tarefa.id}>
                      <td className="mono">{tarefa.targetExternalId}</td>
                      <td className="muted">{tarefa.createdAt.toLocaleString('pt-BR')}</td>
                      <td className="num">{tarefa.attempts}</td>
                      <td>
                        <span
                          className={`pill ${
                            tarefa.status === 'done'
                              ? 'pill--ok'
                              : tarefa.status === 'failed'
                                ? 'pill--danger'
                                : 'pill--info'
                          }`}
                        >
                          {tarefa.status}
                        </span>
                      </td>
                      <td className="subtle">{tarefa.outcome ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <div className="card__head">
          <span className="card__title">Contas que esta autorização liberou</span>
          <span className="card__sub">
            {liberadas.length === 0
              ? 'nenhuma até agora'
              : `${liberadas.length} conta(s) devolvida(s) pela plataforma`}
          </span>
        </div>

        {varredura ? (
          <div className="card__body">
            <div className="triagem">
              <span className="triagem__item">
                <strong>{varredura.raizes ?? 0}</strong> conta(s) alcançável(is) pela autorização
              </span>
              <span className="triagem__item">
                <strong>{varredura.administradoras ?? 0}</strong> administradora(s) — MCC não veicula
                campanha, então não entra como conta de anúncio
              </span>
              <span className="triagem__item">
                <strong>{varredura.recusadas ?? 0}</strong> recusada(s) pela plataforma
                {recusa ? <span className="mono subtle"> · {recusa}</span> : null}
              </span>
              <span className="triagem__item">
                <strong>{liberadas.length}</strong> conta(s) de anúncio utilizável(is)
              </span>
            </div>
          </div>
        ) : null}

        {liberadas.length === 0 ? (
          <div className="empty">
            A plataforma não devolveu nenhuma conta nesta autorização. Isso acontece quando o projeto
            ainda não tem nível de acesso para ler contas de produção, ou quando a conta que concedeu
            não administra nenhuma conta de anúncio.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Identificador</th>
                  <th>Moeda</th>
                  <th>Fuso</th>
                  <th>Administradora</th>
                  <th>Estado</th>
                  <th>Cliente</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {liberadas.map((conta) => {
                  const estado = ESTADO_CONTA[conta.state] ?? { rotulo: conta.state, tom: '' };
                  const vinculada = porExternalId.get(conta.externalId);

                  return (
                    <tr key={conta.id}>
                      <td>
                        <div className="strong">{conta.name}</div>
                        {conta.inactive ? <span className="pill pill--warn">inativa</span> : null}
                      </td>
                      <td className="mono">{conta.externalId}</td>
                      <td>{conta.currency}</td>
                      <td className="muted">{conta.timezone}</td>
                      <td className="mono subtle">{conta.managerExternalId ?? '—'}</td>
                      <td>
                        <span className={`pill ${estado.tom}`}>{estado.rotulo}</span>
                      </td>
                      <td>{vinculada ? vinculada.clientName : <span className="subtle">—</span>}</td>
                      <td>
                        {conta.state === 'discovered' && !conta.inactive ? (
                          <Link className="btn btn--pill" href="/clientes">
                            Vincular a um cliente →
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
