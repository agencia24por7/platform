import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { criarConviteDeIntegracao } from '@/../app/clientes/[id]/acoes';
import { PLATAFORMAS_CONVIDAVEIS } from '@/modules/connections/domain/integrationInvite';
import { MARCA_DA_PLATAFORMA, ROTULO_DA_PLATAFORMA } from '@/modules/connections/domain/connection';
import { requireContext } from '@/shared/http/currentOrganization';
import { canAdminister } from '@/modules/identity/domain/user';

export const dynamic = 'force-dynamic';

export default async function NovoConviteDeIntegracao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  const organization = ctx.organization;

  const { id } = await params;
  const { erro } = await searchParams;

  const cliente = await modules().clients.byId(organization.id, id);
  if (!cliente.ok) notFound();

  if (!canAdminister(ctx.role)) {
    redirect(`/clientes/${id}/acessos?erro=${encodeURIComponent('Só quem administra a organização pode criar convite de integração.')}`);
  }

  return (
    <Shell title={`Convite de integração · ${cliente.value.name}`} organization={organization} active="/clientes">
      <div className="page__head">
        <div>
          <h1 className="page__title">Convidar {cliente.value.name} para conectar</h1>
          <p className="page__sub">
            Escolha as plataformas. O cliente recebe um link único, autoriza com a própria conta, e nada
            disso passa pela sua sessão.
          </p>
        </div>
      </div>

      <Feedback message={erro} tone="error" />

      <form action={criarConviteDeIntegracao} className="card">
        <input type="hidden" name="clientId" value={cliente.value.id} />

        <div className="contas">
          {PLATAFORMAS_CONVIDAVEIS.map((platform) => (
            <label key={platform} className="conta">
              <input type="checkbox" name="platforms" value={platform} />
              <img src={MARCA_DA_PLATAFORMA[platform] ?? ''} alt="" width={22} height={22} />
              <span className="conta__corpo">
                <span className="conta__nome">{ROTULO_DA_PLATAFORMA[platform]}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="page__actions">
          <Link className="btn btn--pill" href={`/clientes/${cliente.value.id}/acessos`}>
            Cancelar
          </Link>
          <button className="btn btn--primary btn--pill" type="submit">
            Criar convite
          </button>
        </div>
      </form>
    </Shell>
  );
}
