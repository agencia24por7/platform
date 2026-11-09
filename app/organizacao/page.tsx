import { redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { canAdminister } from '@/modules/identity/domain/user';
import { atorAtual } from '@/shared/http/ator';
import { text, toActionState } from '@/shared/http/actions';
import { requireContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const EFEITO_DO_TIPO = {
  advertiser: 'Opera as próprias contas. A lista principal chama os cadastros de negócios.',
  agency: 'Opera contas de terceiros. A lista principal chama os cadastros de clientes.',
} as const;

async function mudarTipo(formData: FormData): Promise<void> {
  'use server';

  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  if (!canAdminister(ctx.role)) redirect('/clientes');

  const pedido = text(formData, 'tipo');
  if (pedido !== 'agency' && pedido !== 'advertiser') {
    redirect(`/organizacao?erro=${encodeURIComponent('Tipo desconhecido.')}`);
  }

  const resultado = await modules().organizations.changeType(
    { id: ctx.organization.id, papelDeQuemAge: ctx.role, type: pedido },
    await atorAtual(),
  );
  if (!resultado.ok) {
    redirect(`/organizacao?erro=${encodeURIComponent(toActionState(resultado.error).error ?? '')}`);
  }

  redirect(`/organizacao?feito=${encodeURIComponent('Tipo da organização atualizado.')}`);
}

export default async function OrganizacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; feito?: string }>;
}) {
  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');

  const aviso = await searchParams;
  const organization = ctx.organization;
  const podeAdministrar = canAdminister(ctx.role);

  return (
    <Shell title="Organização" organization={organization} active="/organizacao">
      <div className="page__head">
        <div>
          <div className="page__title">{organization.name}</div>
          <div className="page__sub">
            Um freelancer que vira agência não precisa recomeçar: o tipo muda, os clientes e o
            histórico seguem.
          </div>
        </div>
      </div>

      <Feedback message={aviso.erro} tone="error" />
      <Feedback message={aviso.feito} tone="ok" />

      <div className="card">
        <div className="card__head">
          <span className="card__title">Como esta organização trabalha</span>
          <span className="card__sub">{EFEITO_DO_TIPO[organization.type]}</span>
        </div>
        {podeAdministrar ? (
          <form className="form form--linha" action={mudarTipo}>
            <label className="field">
              <span className="field__label">Tipo</span>
              <select className="select" name="tipo" defaultValue={organization.type}>
                <option value="advertiser">Anunciante — opera as próprias contas</option>
                <option value="agency">Agência — opera contas de clientes</option>
              </select>
              <span className="field__hint">
                A troca só muda a leitura das telas e fica registrada na auditoria. Nenhum dado é
                movido ou apagado.
              </span>
            </label>
            <button className="btn" type="submit">
              Aplicar
            </button>
          </form>
        ) : (
          <div className="empty">Só quem administra a organização pode mudar isso.</div>
        )}
      </div>

      <div className="card">
        <div className="card__head">Identificadores</div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              <tr>
                <td className="strong">Apelido</td>
                <td className="mono muted">{organization.slug}</td>
              </tr>
              <tr>
                <td className="strong">Administradora do Google</td>
                <td className="mono muted">{organization.managerAccountId ?? '—'}</td>
              </tr>
              <tr>
                <td className="strong">Business Manager</td>
                <td className="mono muted">{organization.businessManagerId ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
