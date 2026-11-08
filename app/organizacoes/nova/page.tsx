import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Wizard } from '@/../app/_components/Wizard';
import { modules } from '@/composition';
import { currentUser } from '@/shared/http/currentUser';
import type { OrganizationType } from '@/modules/organizations/domain/organization';
import { optionalText, requestId, text, toActionState } from '@/shared/http/actions';

export const dynamic = 'force-dynamic';

async function createOrganization(formData: FormData): Promise<void> {
  'use server';

  const sessao = await currentUser();
  if (!sessao) redirect('/entrar');
  if (sessao.memberships.length > 0) redirect('/clientes');

  const type: OrganizationType = text(formData, 'type') === 'advertiser' ? 'advertiser' : 'agency';
  const result = await modules().organizations.create(
    {
      name: text(formData, 'name'),
      type,
      managerAccountId: optionalText(formData, 'managerAccountId'),
      businessManagerId: optionalText(formData, 'businessManagerId'),
      developerTokenRef: null,
    },
    requestId(),
  );

  if (!result.ok) {
    const message = toActionState(result.error).error ?? '';
    redirect(`/organizacoes/nova?tipo=${type}&erro=${encodeURIComponent(message)}`);
  }

  const vinculo = await modules().identity.joinAsOwner(result.value.id, sessao.user.id, requestId());
  if (!vinculo.ok) {
    const message = toActionState(vinculo.error).error ?? '';
    redirect(`/organizacoes/nova?tipo=${type}&erro=${encodeURIComponent(message)}`);
  }

  redirect('/comecar?passo=conectar&organizacao=criada');
}

function Choice() {
  return (
    <>
      <div>
        <div className="wizard__eyebrow">Passo 2 de 3 · Operação</div>
        <div>
          <div className="wizard__heading">Quem vai usar a plataforma?</div>
          <div className="wizard__sub">
            A escolha muda só a linguagem das telas e quem aparece como cliente. Nenhuma das duas exige
            estrutura montada: não é preciso conta administradora, Business Manager nem token para
            começar — as contas são descobertas na autorização.
          </div>
        </div>
      </div>

      <div className="grid grid--2">
        <Link href="/organizacoes/nova?tipo=agency" className="card" style={{ display: 'block' }}>
          <div className="card__body">
            <span className="strong">Opero contas de clientes</span>
            <span className="muted small">
              Agência, consultoria ou parceiro. Cada cliente vira um ambiente isolado, com as contas de
              anúncio dele e acesso controlado por pessoa.
            </span>
          </div>
        </Link>

        <Link
          href="/organizacoes/nova?tipo=advertiser"
          className="card"
          style={{ display: 'block' }}
        >
          <div className="card__body">
            <span className="strong">Opero as contas da minha empresa</span>
            <span className="muted small">
              De uma operação só a um time inteiro, com várias marcas, unidades ou filiais. Cada negócio
              vira um ambiente, e o acesso de cada pessoa é definido por você.
            </span>
          </div>
        </Link>
      </div>
    </>
  );
}

function AgencyFields() {
  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor="name">
          Nome da agência
        </label>
        <input className="input" id="name" name="name" required minLength={2} maxLength={120} autoFocus />
        <span className="field__hint">É o nome que aparece no painel e nos relatórios internos.</span>
      </div>

      <div className="note">
        <div className="note__title">O que acontece depois daqui</div>
        <div>
          Você autoriza Google Ads e Meta pelos canais oficiais. A plataforma lista as contas que a
          autorização alcança — inclusive as que chegam por conta administradora ou por parceria entre
          Business Managers — e você escolhe quais entram.
        </div>
      </div>

      <StructureDisclosure />
    </>
  );
}

function AdvertiserFields() {
  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor="name">
          Nome da empresa
        </label>
        <input className="input" id="name" name="name" required minLength={2} maxLength={120} autoFocus />
        <span className="field__hint">
          Se você toca mais de uma marca ou unidade, cadastre cada uma depois — aqui é o nome da operação
          como um todo.
        </span>
      </div>

      <div className="note">
        <div className="note__title">Nada precisa estar pronto</div>
        <div>
          Você conecta direto com a conta que já usa para anunciar, nas duas plataformas. A autorização
          lista as contas que você pode acessar e você marca quais entram.
        </div>
      </div>

      <StructureDisclosure />
    </>
  );
}

function StructureDisclosure() {
  return (
    <details className="disclosure">
      <summary>Já tenho conta administradora ou Business Manager</summary>
      <div>
        <p className="muted small" style={{ marginBottom: 12 }}>
          Opcional. Esses identificadores são preenchidos sozinhos quando a autorização descobre as contas.
          Informe agora só se quiser deixar registrado.
        </p>

        <div className="grid grid--2">
          <div className="field">
            <label className="field__label" htmlFor="managerAccountId">
              Conta administradora do Google Ads
            </label>
            <input
              className="input"
              id="managerAccountId"
              name="managerAccountId"
              placeholder="123-456-7890"
              maxLength={64}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="businessManagerId">
              Business Manager do Meta
            </label>
            <input
              className="input"
              id="businessManagerId"
              name="businessManagerId"
              placeholder="1094887233"
              maxLength={64}
            />
          </div>
        </div>
      </div>
    </details>
  );
}

export default async function NewOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; erro?: string }>;
}) {
  const sessao = await currentUser();
  if (!sessao) redirect('/entrar');
  if (sessao.memberships.length > 0) redirect('/clientes');

  const params = await searchParams;
  const type: OrganizationType | null =
    params.tipo === 'agency' ? 'agency' : params.tipo === 'advertiser' ? 'advertiser' : null;

  if (!type) {
    return (
      <Wizard current="operacao">
        <Choice />
      </Wizard>
    );
  }

  const isAgency = type === 'agency';

  return (
    <Wizard current="operacao">
      <div className="page__head">
        <div>
          <div className="wizard__eyebrow">Passo 2 de 3 · Operação</div>
          <div className="wizard__heading">{isAgency ? 'Cadastrar a agência' : 'Cadastrar a empresa'}</div>
          <div className="wizard__sub">
            {isAgency
              ? 'Um nome e pronto. O resto é descoberto quando você autorizar as plataformas.'
              : 'Um nome e pronto. O resto é descoberto quando você autorizar as plataformas.'}
          </div>
        </div>
        <div className="page__actions">
          <Link className="btn" href="/organizacoes/nova">
            Trocar tipo
          </Link>
        </div>
      </div>

      <Feedback message={params.erro} tone="error" />

      <form action={createOrganization} className="card">
        <input type="hidden" name="type" value={type} />
        <div className="card__body">{isAgency ? <AgencyFields /> : <AdvertiserFields />}</div>
        <div className="card__foot row">
          <span className="spacer" />
          <button className="btn btn--primary" type="submit">
            Criar e continuar
          </button>
        </div>
      </form>
    </Wizard>
  );
}
