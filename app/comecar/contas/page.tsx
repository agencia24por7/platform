import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Wizard } from '@/../app/_components/Wizard';
import { clienteNoEscopo } from '@/../app/clientes/[id]/_escopo';
import { modules } from '@/composition';
import { atorAtual } from '@/shared/http/ator';
import { list, requestId, text } from '@/shared/http/actions';
import { activeContext, requireContext } from '@/shared/http/currentOrganization';
import { env } from '@/shared/config/env';
import { podeCadastrarCliente } from '@/modules/clients/domain/painel/permissoes';
import { clienteDaRetomada, emitirRetomada } from '@/modules/clients/domain/retomadaDoCadastro';
import { vocabularioDe } from '@/modules/organizations/domain/vocabulario';
import { veiculaAnuncio } from '@/modules/connections/domain/connection';
import type { StoredDiscovery } from '@/modules/connections/infrastructure/discoveredAccountRepository';

export const dynamic = 'force-dynamic';

async function contasDeAnuncioPendentes(organizationId: string): Promise<readonly StoredDiscovery[]> {
  const pendentes = await modules().discoveredAccounts.listPending(organizationId);
  return pendentes.filter((conta) => veiculaAnuncio(conta.platform));
}

type Contexto = Awaited<ReturnType<typeof requireContext>>;

function donoDaRetomada(ctx: Contexto) {
  return { organizationId: ctx.organization.id, userId: ctx.session.user.id };
}

async function clienteRetomado(ctx: Contexto, bruto: unknown) {
  const clientId = clienteDaRetomada(bruto, donoDaRetomada(ctx), env().TRIA_SESSION_SECRET, Date.now());
  return clientId ? clienteNoEscopo(ctx, clientId) : null;
}

function voltarComErro(mensagem: string, retomada: string | null = null): never {
  const busca = new URLSearchParams({ erro: mensagem });
  if (retomada) busca.set('retomar', retomada);
  redirect(`/comecar/contas?${busca.toString()}`);
}

async function linkSelected(formData: FormData): Promise<void> {
  'use server';

  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  const organization = ctx.organization;
  const vocabulario = vocabularioDe(organization.type);
  if (!podeCadastrarCliente(organization.type, ctx.role)) {
    redirect(`/comecar/contas?erro=${encodeURIComponent(`Seu papel não permite cadastrar ${vocabulario.cliente} nem vincular contas.`)}`);
  }

  const ator = await atorAtual();

  const selected = list(formData, 'selecionadas');
  const clientName = text(formData, 'clientName') || organization.name;

  const retomada = formData.get('retomada');
  if (selected.length === 0) voltarComErro('nenhuma', typeof retomada === 'string' ? retomada : null);

  const pending = await contasDeAnuncioPendentes(organization.id);
  const chosen = pending.filter((account) => selected.includes(account.id));

  let clientId: string;
  if (retomada !== null) {
    const retomado = await clienteRetomado(ctx, retomada);
    if (!retomado) {
      voltarComErro(`A tentativa anterior expirou ou não vale para esta sessão. Nenhuma conta foi vinculada; vincule as que faltam pela página do ${vocabulario.cliente}.`);
    }
    clientId = retomado.id;
  } else {
    const client = await modules().clients.create(
      {
        organizationId: organization.id,
        parentClientId: null,
        name: clientName,
        segment: null,
        businessModel: 'leads',
        tipoDaOrganizacao: organization.type,
        papelDeQuemAge: ctx.role,
      },
      ator,
    );
    if (!client.ok) {
      voltarComErro(`Não foi possível criar o ${vocabulario.cliente}: ${client.error.message} Nenhuma conta foi vinculada.`);
    }
    clientId = client.value.id;
  }
  let falhas = 0;

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
    } else {
      falhas += 1;
    }
  }

  if (falhas > 0) {
    voltarComErro(
      `${falhas} conta(s) não foram vinculadas. As demais continuam pendentes; tente de novo e elas vão para o mesmo ${vocabulario.cliente}.`,
      emitirRetomada(donoDaRetomada(ctx), clientId, env().TRIA_SESSION_SECRET, Date.now()),
    );
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
  searchParams: Promise<{ erro?: string; retomar?: string }>;
}) {
  const ctx = await activeContext();
  if (!ctx) redirect('/comecar');
  const organization = ctx.organization;
  const vocabulario = vocabularioDe(organization.type);

  const [params, pending] = await Promise.all([
    searchParams,
    contasDeAnuncioPendentes(organization.id),
  ]);
  const retomado = podeCadastrarCliente(organization.type, ctx.role) && ctx.clientIds === null ? await clienteRetomado(ctx, params.retomar) : null;

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
      ) : (
        <Feedback message={params.erro} tone="error" />
      )}

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
            {retomado && params.retomar ? (
              <div className="field">
                <input type="hidden" name="retomada" value={params.retomar} />
                <span className="field__label">As contas marcadas vão para {retomado.name}</span>
                <span className="field__hint">
                  É o {vocabulario.cliente} criado na tentativa anterior; as contas que já entraram continuam com ele.
                </span>
              </div>
            ) : (
              <div className="field">
                <label className="field__label" htmlFor="clientName">
                  Agrupar estas contas sob qual nome?
                </label>
                <input className="input" id="clientName" name="clientName" defaultValue={organization.name} maxLength={120} />
                <span className="field__hint">
                  Dá para reorganizar em clientes e redes depois, sem refazer a autorização.
                </span>
              </div>
            )}

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
