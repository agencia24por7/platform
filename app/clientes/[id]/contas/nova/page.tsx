import { notFound, redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import type { Platform } from '@/modules/connections/domain/connection';
import { checkbox, list, optionalText, requestId, text, toActionState } from '@/shared/http/actions';
import { currentOrganization } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const SCOPES: Record<Platform, readonly { value: string; label: string; required: boolean }[]> = {
  google: [
    { value: 'adwords', label: 'adwords — ler métricas e gerenciar campanhas', required: true },
    { value: 'datamanager', label: 'datamanager — público semelhante e conversão offline', required: false },
  ],
  meta: [
    { value: 'ads_read', label: 'ads_read — ler campanhas e insights', required: true },
    { value: 'ads_management', label: 'ads_management — criar e alterar campanhas', required: false },
    { value: 'business_management', label: 'business_management — ativos do Business Manager', required: false },
    { value: 'leads_retrieval', label: 'leads_retrieval — puxar leads dos formulários', required: false },
  ],
};

async function connectAccount(formData: FormData): Promise<void> {
  'use server';

  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const clientId = text(formData, 'clientId');
  const platform: Platform = text(formData, 'platform') === 'google' ? 'google' : 'meta';
  const back = (message: string): never =>
    redirect(`/clientes/${clientId}/contas/nova?erro=${encodeURIComponent(message)}`);

  let connectionId = text(formData, 'connectionId');

  if (connectionId === 'new') {
    const created = await modules().connections.createConnection(
      {
        organizationId: organization.id,
        platform,
        grantType: text(formData, 'grantType') as 'mcc' | 'bm_partner' | 'system_user' | 'oauth_user',
        label: text(formData, 'connectionLabel'),
        externalId: text(formData, 'connectionExternalId'),
        scopes: list(formData, 'scopes'),
        credentialRef: text(formData, 'credentialRef'),
        expiresAt: null,
      },
      requestId(),
    );

    if (!created.ok) back(toActionState(created.error).error ?? 'Falha ao criar autorização.');
    else connectionId = created.value.id;
  }

  const linked = await modules().connections.linkAccount(
    {
      organizationId: organization.id,
      clientId,
      connectionId,
      platform,
      externalId: text(formData, 'externalId'),
      name: text(formData, 'name'),
      accountGroup: optionalText(formData, 'accountGroup') ?? 'Principal',
      currency: optionalText(formData, 'currency') ?? 'BRL',
      timezone: optionalText(formData, 'timezone') ?? 'America/Sao_Paulo',
      syncEnabled: checkbox(formData, 'syncEnabled'),
    },
    requestId(),
  );

  if (!linked.ok) back(toActionState(linked.error).error ?? 'Falha ao vincular conta.');

  redirect(`/clientes/${clientId}`);
}

export default async function NewAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const found = await modules().clients.byId(organization.id, id);
  if (!found.ok) notFound();

  const connections = await modules().connections.listConnections(organization.id);

  return (
    <Shell title="Conectar conta" organization={organization} active="/clientes">
      <div className="page__head">
        <div>
          <div className="page__title">Conectar conta de anúncios</div>
          <div className="page__sub">
            Passo 2 de 2 para {found.value.name}. Uma autorização descobre N contas — por isso a conexão e
            a conta são registros separados.
          </div>
        </div>
      </div>

      <div className="steps">
        <span className="step step--done">1 · Dados do cliente</span>
        <span className="step step--active">2 · Contas de anúncio</span>
      </div>

      <Feedback message={query.erro} tone="error" />

      <div className="alert alert--info">
        Este é o caminho manual, para quando a autorização pelas plataformas ainda não está disponível. O
        segredo nunca é digitado aqui: o campo de credencial guarda apenas a referência de onde o token
        vive no cofre do n8n.
      </div>

      <form action={connectAccount} className="card">
        <input type="hidden" name="clientId" value={found.value.id} />
        <div className="card__body">
          <div className="grid grid--2">
            <div className="field">
              <label className="field__label" htmlFor="platform">
                Plataforma
              </label>
              <select className="select" id="platform" name="platform" defaultValue="meta">
                <option value="meta">Meta Ads</option>
                <option value="google">Google Ads</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="connectionId">
                Autorização
              </label>
              <select className="select" id="connectionId" name="connectionId" defaultValue="new">
                <option value="new">Criar nova autorização</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.label} · {connection.platform} · {connection.externalId}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="card card--warn">
            <div className="card__head">
              <span className="card__title">Nova autorização</span>
              <span className="card__sub">Preencha só se escolheu criar uma</span>
            </div>
            <div className="card__body">
              <div className="grid grid--2">
                <div className="field">
                  <label className="field__label" htmlFor="connectionLabel">
                    Nome da autorização
                  </label>
                  <input
                    className="input"
                    id="connectionLabel"
                    name="connectionLabel"
                    placeholder="Business Manager da agência"
                    maxLength={120}
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="grantType">
                    Caminho
                  </label>
                  <select className="select" id="grantType" name="grantType" defaultValue="system_user">
                    <option value="mcc">MCC da organização (Google)</option>
                    <option value="oauth_user">OAuth direto (Google)</option>
                    <option value="bm_partner">Parceria entre Business Managers (Meta)</option>
                    <option value="system_user">Usuário do sistema (Meta)</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="connectionExternalId">
                    ID externo da estrutura
                  </label>
                  <input
                    className="input"
                    id="connectionExternalId"
                    name="connectionExternalId"
                    placeholder="812-445-9031 ou 1094887233"
                    maxLength={64}
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="credentialRef">
                    Referência da credencial no n8n
                  </label>
                  <input
                    className="input"
                    id="credentialRef"
                    name="credentialRef"
                    placeholder="n8n:credential:meta-system-user"
                    maxLength={128}
                  />
                  <span className="field__hint">Ponteiro, não segredo.</span>
                </div>
              </div>
              <div className="field">
                <span className="field__label">Escopos concedidos</span>
                {[...SCOPES.meta, ...SCOPES.google].map((scope) => (
                  <label key={scope.value} className="checkline">
                    <input type="checkbox" name="scopes" value={scope.value} defaultChecked={scope.required} />
                    <span>{scope.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid--2">
            <div className="field">
              <label className="field__label" htmlFor="externalId">
                ID da conta de anúncios
              </label>
              <input
                className="input"
                id="externalId"
                name="externalId"
                required
                placeholder="act_1234567890 ou 123-456-7890"
                maxLength={64}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="name">
                Nome da conta
              </label>
              <input className="input" id="name" name="name" required minLength={2} maxLength={160} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="accountGroup">
                Grupo
              </label>
              <input className="input" id="accountGroup" name="accountGroup" defaultValue="Principal" maxLength={60} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="currency">
                Moeda
              </label>
              <input className="input" id="currency" name="currency" defaultValue="BRL" maxLength={3} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="timezone">
                Fuso
              </label>
              <input
                className="input"
                id="timezone"
                name="timezone"
                defaultValue="America/Sao_Paulo"
                maxLength={64}
              />
            </div>
            <div className="field">
              <span className="field__label">Coleta</span>
              <label className="checkline">
                <input type="checkbox" name="syncEnabled" defaultChecked />
                <span>Entrar na fila de coleta do n8n</span>
              </label>
            </div>
          </div>
        </div>
        <div className="card__foot row">
          <span className="spacer" />
          <button className="btn btn--primary" type="submit">
            Conectar conta
          </button>
        </div>
      </form>
    </Shell>
  );
}
