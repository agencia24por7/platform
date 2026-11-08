import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { checkbox, requestId, text, toActionState } from '@/shared/http/actions';
import { currentOrganization } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const PLATAFORMA = {
  google: { nome: 'Google Ads', marca: '/marcas/google-ads.png' },
  meta: { nome: 'Meta Ads', marca: '/marcas/meta.png' },
} as const;

async function vincularConta(formData: FormData): Promise<void> {
  'use server';

  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const clientId = text(formData, 'clientId');
  const descobertaId = text(formData, 'descobertaId');
  const voltar = (mensagem: string): never =>
    redirect(`/clientes/${clientId}/contas/nova?erro=${encodeURIComponent(mensagem)}`);

  const descobertas = await modules().discoveredAccounts.listPending(organization.id);
  const escolhida = descobertas.find((conta) => conta.id === descobertaId);
  if (!escolhida) {
    voltar('Conta não encontrada entre as descobertas desta organização.');
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
      syncEnabled: checkbox(formData, 'coletar'),
    },
    requestId(),
  );

  if (!vinculada.ok) {
    voltar(toActionState(vinculada.error).error ?? 'Falha ao vincular conta.');
    return;
  }

  await modules().discoveredAccounts.markLinked(organization.id, escolhida.id, vinculada.value.id);
  redirect(`/clientes/${clientId}`);
}

export default async function VincularConta({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const { id } = await params;
  const { erro } = await searchParams;

  const cliente = await modules().clients.byId(organization.id, id);
  if (!cliente.ok) notFound();

  const descobertas = await modules().discoveredAccounts.listPending(organization.id);
  const disponiveis = descobertas.filter((conta) => !conta.inactive);
  const inativas = descobertas.filter((conta) => conta.inactive);

  return (
    <Shell title={`Vincular conta · ${cliente.value.name}`} organization={organization} active="/clientes">
      <div className="page__head">
        <div>
          <h1 className="page__title">Vincular conta a {cliente.value.name}</h1>
          <p className="page__sub">
            Estas são as contas que as plataformas liberaram para você. Escolha quais pertencem a este
            cliente — nada aqui é digitado à mão.
          </p>
        </div>
      </div>

      <Feedback message={erro} tone="error" />

      {descobertas.length === 0 ? (
        <div className="vazio">
          <p className="vazio__titulo">Nenhuma conta disponível ainda</p>
          <p className="vazio__texto">
            As contas aparecem aqui depois que você autoriza a plataforma. A tria só enxerga o que o
            Google ou a Meta devolvem na autorização.
          </p>
          <Link className="btn btn--primary btn--pill" href="/comecar?passo=conectar">
            Conectar uma plataforma →
          </Link>
        </div>
      ) : (
        <form action={vincularConta} className="card">
          <input type="hidden" name="clientId" value={cliente.value.id} />

          <div className="contas">
            {disponiveis.map((conta, indice) => (
              <label key={conta.id} className="conta">
                <input
                  type="radio"
                  name="descobertaId"
                  value={conta.id}
                  defaultChecked={indice === 0}
                  required
                />
                <img src={PLATAFORMA[conta.platform].marca} alt="" width={22} height={22} />
                <span className="conta__corpo">
                  <span className="conta__nome">{conta.name}</span>
                  <span className="conta__meta">
                    {PLATAFORMA[conta.platform].nome} · {conta.externalId} · {conta.currency} ·{' '}
                    {conta.timezone}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {inativas.length > 0 ? (
            <p className="quiet-link">
              {inativas.length} conta{inativas.length > 1 ? 's' : ''} inativa
              {inativas.length > 1 ? 's' : ''} na plataforma não {inativas.length > 1 ? 'são' : 'é'}{' '}
              oferecida{inativas.length > 1 ? 's' : ''} aqui.
            </p>
          ) : null}

          <label className="check">
            <input type="checkbox" name="coletar" defaultChecked />
            Coletar métricas desta conta todo dia
          </label>

          <div className="page__actions">
            <Link className="btn btn--pill" href={`/clientes/${cliente.value.id}`}>
              Cancelar
            </Link>
            <button className="btn btn--primary btn--pill" type="submit">
              Vincular conta
            </button>
          </div>
        </form>
      )}
    </Shell>
  );
}
