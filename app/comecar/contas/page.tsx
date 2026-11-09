import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Wizard } from '@/../app/_components/Wizard';
import { modules } from '@/composition';
import { atorAtual } from '@/shared/http/ator';
import { list, requestId, text } from '@/shared/http/actions';
import { currentOrganization, requireContext } from '@/shared/http/currentOrganization';
import { canOperate } from '@/modules/identity/domain/user';

export const dynamic = 'force-dynamic';

async function linkSelected(formData: FormData): Promise<void> {
  'use server';

  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  if (!canOperate(ctx.role)) {
    redirect(`/comecar/contas?erro=${encodeURIComponent('Seu papel não permite vincular contas.')}`);
  }
  const organization = ctx.organization;

  const ator = await atorAtual();

  const selected = list(formData, 'selecionadas');
  const clientName = text(formData, 'clientName') || organization.name;

  if (selected.length === 0) redirect('/comecar/contas?erro=nenhuma');

  const pending = await modules().discoveredAccounts.listPending(organization.id);
  const chosen = pending.filter((account) => selected.includes(account.id));

  const client = await modules().clients.create(
    {
      organizationId: organization.id,
      parentClientId: null,
      name: clientName,
      segment: null,
      businessModel: 'leads',
    },
    ator,
  );

  const clientId = client.ok
    ? client.value.id
    : (await modules().clients.list(organization.id))[0]?.id;

  if (!clientId) redirect('/comecar/contas?erro=cliente');

  for (const account of chosen) {
    const linked = await modules().connections.linkAccount(
      {
        organizationId: organization.id,
        clientId,
        connectionId: account.connectionId,
        platform: account.platform,
        externalId: account.externalId,
        name: account.name,
        accountGroup: 'Principal',
        currency: account.currency,
        timezone: account.timezone,
        syncEnabled: true,
      },
      ator,
    );

    if (linked.ok) {
      await modules().discoveredAccounts.markLinked(organization.id, account.id, linked.value.id);
    }
  }

  for (const account of pending) {
    if (!selected.includes(account.id)) {
      await modules().discoveredAccounts.markIgnored(organization.id, account.id);
    }
  }

  redirect('/clientes');
}

export default async function SelectAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const organization = await currentOrganization();
  if (!organization) redirect('/comecar');

  const [params, pending] = await Promise.all([
    searchParams,
    modules().discoveredAccounts.listPending(organization.id),
  ]);

  return (
    <Wizard current="contas">
      <div>
        <div className="wizard__eyebrow">Passo 3 de 3 · Contas</div>
        <h1 className="wizard__heading">Escolha o que entra na plataforma</h1>
        <p className="wizard__sub">
          A autorização alcançou {pending.length} conta{pending.length === 1 ? '' : 's'}. Só as marcadas
          passam a ser coletadas — as outras ficam registradas como ignoradas e podem ser ligadas depois.
        </p>
      </div>

      {params.erro === 'nenhuma' ? (
        <div className="alert alert--error">Marque ao menos uma conta para continuar.</div>
      ) : null}

      {pending.length === 0 ? (
        <div className="card">
          <div className="card__body">
            <span className="strong">Nenhuma conta pendente de seleção</span>
            <span className="muted small">
              Ou todas já foram vinculadas, ou a autorização ainda não aconteceu.
            </span>
            <Link className="btn" href="/comecar?passo=conectar">
              Voltar para a conexão
            </Link>
          </div>
        </div>
      ) : (
        <form action={linkSelected} className="card">
          <div className="card__body">
            <div className="field">
              <label className="field__label" htmlFor="clientName">
                Agrupar estas contas sob qual nome?
              </label>
              <input className="input" id="clientName" name="clientName" defaultValue={organization.name} maxLength={120} />
              <span className="field__hint">
                Dá para reorganizar em clientes e redes depois, sem refazer a autorização.
              </span>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }} />
                    <th>Conta</th>
                    <th>Plataforma</th>
                    <th>Moeda</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((account) => (
                    <tr key={account.id}>
                      <td>
                        <input
                          type="checkbox"
                          name="selecionadas"
                          value={account.id}
                          defaultChecked={!account.inactive}
                        />
                      </td>
                      <td>
                        <div className="strong">{account.name}</div>
                        <div className="mono subtle">{account.externalId}</div>
                      </td>
                      <td>{account.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}</td>
                      <td className="muted">{account.currency}</td>
                      <td>
                        {account.inactive ? (
                          <span className="pill">sem atividade</span>
                        ) : (
                          <span className="pill pill--ok">
                            <span className="dot" />
                            ativa
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card__foot row">
            <span className="spacer" />
            <button className="btn btn--primary" type="submit">
              Vincular e começar a coletar
            </button>
          </div>
        </form>
      )}
    </Wizard>
  );
}
