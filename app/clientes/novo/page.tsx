import { redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { atorAtual } from '@/shared/http/ator';
import { optionalText, requestId, text, toActionState } from '@/shared/http/actions';
import { currentOrganization } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

async function createClient(formData: FormData): Promise<void> {
  'use server';

  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const ator = await atorAtual();

  const model = text(formData, 'businessModel');
  const result = await modules().clients.create(
    {
      organizationId: organization.id,
      parentClientId: optionalText(formData, 'parentClientId'),
      name: text(formData, 'name'),
      segment: optionalText(formData, 'segment'),
      businessModel: model === 'ecommerce' ? 'ecommerce' : 'leads',
    },
    ator,
  );

  if (!result.ok) {
    redirect(`/clientes/novo?erro=${encodeURIComponent(toActionState(result.error).error ?? '')}`);
  }

  redirect(`/clientes/${result.value.id}`);
}

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const [params, clients] = await Promise.all([searchParams, modules().clients.list(organization.id)]);
  const possibleParents = clients.filter((client) => client.parentClientId === null);
  const noun = organization.type === 'advertiser' ? 'negócio' : 'cliente';

  return (
    <Shell title={`Novo ${noun}`} organization={organization} active="/clientes">
      <div className="page__head">
        <div>
          <div className="page__title">Cadastrar {noun}</div>
          <div className="page__sub">
            Passo 1 de 2. Depois do cadastro você vincula as contas de anúncio.
          </div>
        </div>
      </div>

      <div className="steps">
        <span className="step step--active">1 · Dados do {noun}</span>
        <span className="step">2 · Contas de anúncio</span>
      </div>

      <Feedback message={params.erro} tone="error" />

      <form action={createClient} className="card">
        <div className="card__body">
          <div className="grid grid--2">
            <div className="field">
              <label className="field__label" htmlFor="name">
                Nome
              </label>
              <input className="input" id="name" name="name" required minLength={2} maxLength={120} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="segment">
                Segmento
              </label>
              <input className="input" id="segment" name="segment" maxLength={120} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="businessModel">
                Modelo de negócio
              </label>
              <select className="select" id="businessModel" name="businessModel" defaultValue="leads">
                <option value="leads">Leads — CPL, volume, qualificação</option>
                <option value="ecommerce">E-commerce — ROAS, receita, ticket</option>
              </select>
              <span className="field__hint">Define quais indicadores o painel e o agente usam.</span>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="parentClientId">
                Pertence a uma rede
              </label>
              <select className="select" id="parentClientId" name="parentClientId" defaultValue="">
                <option value="">Não — operação independente</option>
                {possibleParents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    Filial de {parent.name}
                  </option>
                ))}
              </select>
              <span className="field__hint">A hierarquia aceita um nível: rede e filial.</span>
            </div>
          </div>
        </div>
        <div className="card__foot row">
          <span className="spacer" />
          <button className="btn btn--primary" type="submit">
            Salvar e ir para contas
          </button>
        </div>
      </form>
    </Shell>
  );
}
