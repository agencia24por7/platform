import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { encurtarEscopo } from '@/modules/audit/domain/auditView';
import { missingScopes, readinessOf } from '@/modules/connections/domain/connection';
import { currentOrganization } from '@/shared/http/currentOrganization';

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

export default async function DetalheAutorizacao({ params }: { params: Promise<{ id: string }> }) {
  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const { id } = await params;

  const conexoes = await modules().connections.listConnections(organization.id);
  const conexao = conexoes.find((item) => item.id === id);
  if (!conexao) notFound();

  const [liberadas, vinculadas, eventos] = await Promise.all([
    modules().discoveredAccounts.listByConnection(organization.id, conexao.id),
    modules().connections.listAccounts(organization.id),
    modules().audit.search(organization.id, { targetId: conexao.id, limit: 20 }),
  ]);

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

      <div className="grid grid--3">
        <div className="card">
          <div className="card__head">
            <span className="card__title">Identidade</span>
          </div>
          <div className="card__body">
            <div className="dupla">
              <span>Plataforma</span>
              <span className="com-marca">
                <img src={plataforma.marca} alt="" width={16} height={16} />
                {plataforma.nome}
              </span>
            </div>
            <div className="dupla">
              <span>Conta que concedeu</span>
              <span>{conexao.accountEmail ?? <span className="subtle">não informado</span>}</span>
            </div>
            <div className="dupla">
              <span>Id na plataforma</span>
              <span className="mono">{conexao.externalId}</span>
            </div>
            <div className="dupla">
              <span>Estado</span>
              <span className={`pill ${prontidao.collectable ? 'pill--ok' : 'pill--warn'}`}>
                {conexao.status}
              </span>
            </div>
            <div className="dupla">
              <span>Credencial</span>
              <span>{prontidao.collectable ? 'guardada no cofre' : 'ausente'}</span>
            </div>
            {conexao.expiresAt ? (
              <div className="dupla">
                <span>Expira</span>
                <span>{conexao.expiresAt.toLocaleString('pt-BR')}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <span className="card__title">Quem autorizou</span>
          </div>
          <div className="card__body">
            {autorizacao ? (
              <>
                <div className="dupla">
                  <span>Pessoa</span>
                  <span className="mono" title={autorizacao.actorId ?? ''}>
                    {autorizacao.actorId ? autorizacao.actorId.slice(0, 8) : '—'}
                  </span>
                </div>
                <div className="dupla">
                  <span>Quando</span>
                  <span>{autorizacao.occurredAt.toLocaleString('pt-BR')}</span>
                </div>
                <div className="dupla">
                  <span>Origem</span>
                  <span className="mono">{autorizacao.sourceIp ?? '—'}</span>
                </div>
                <div className="dupla">
                  <span>Requisição</span>
                  <span className="mono" title={autorizacao.requestId ?? ''}>
                    {autorizacao.requestId ? autorizacao.requestId.slice(0, 8) : '—'}
                  </span>
                </div>
              </>
            ) : (
              <p className="subtle">
                Sem evento de auditoria para esta autorização. Ela é anterior ao registro de autor.
              </p>
            )}
            <Link className="quiet-link" href={`/auditoria?evento=connection.authorize`}>
              ver na trilha de auditoria →
            </Link>
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
      </div>

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
