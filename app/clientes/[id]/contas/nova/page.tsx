import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import {
  MARCA_DA_PLATAFORMA,
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_RECURSO,
  temRecursoParaVincular,
  veiculaAnuncio,
} from '@/modules/connections/domain/connection';
import type { StoredDiscovery } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import { atorAtual } from '@/shared/http/ator';
import { checkbox, requestId, text, toActionState } from '@/shared/http/actions';
import { currentOrganization, requireContext } from '@/shared/http/currentOrganization';
import { canOperate } from '@/modules/identity/domain/user';
import { fonteDe } from '@/modules/coleta/domain/mapaDeFontes';

export const dynamic = 'force-dynamic';

async function vincularConta(formData: FormData): Promise<void> {
  'use server';

  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  const organization = ctx.organization;

  const ator = await atorAtual();

  const clientId = text(formData, 'clientId');
  if (!canOperate(ctx.role)) {
    redirect(`/clientes/${clientId}/contas/nova?erro=${encodeURIComponent('Seu papel não permite vincular contas.')}`);
  }
  const descobertaId = text(formData, 'descobertaId');
  const voltar = (mensagem: string): never =>
    redirect(`/clientes/${clientId}/contas/nova?erro=${encodeURIComponent(mensagem)}`);

  const descobertas = await modules().discoveredAccounts.listPending(organization.id);
  const escolhida = descobertas.find((conta) => conta.id === descobertaId);
  if (!escolhida) {
    voltar('Conta não encontrada entre as descobertas desta organização.');
    return;
  }

  if (temRecursoParaVincular(escolhida.platform)) {
    const fonte = await modules().recursos.vincular(
      { organizationId: organization.id, papelDeQuemAge: ctx.role, recursoId: escolhida.id, clientId },
      ator,
    );
    if (!fonte.ok) {
      voltar(toActionState(fonte.error).error ?? 'Falha ao vincular fonte.');
      return;
    }
    const proximoPasso = fonteDe(escolhida.platform).ativaNoV1 ? ' Entra na próxima coleta.' : '';
    redirect(`/clientes/${clientId}/conexoes?secao=fontes&feito=${encodeURIComponent(`${escolhida.name} vinculada.${proximoPasso}`)}`);
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
    ator,
  );

  if (!vinculada.ok) {
    voltar(toActionState(vinculada.error).error ?? 'Falha ao vincular conta.');
    return;
  }

  await modules().discoveredAccounts.markLinked(organization.id, escolhida.id, vinculada.value.id);
  redirect(`/clientes/${clientId}/conexoes?secao=fontes`);
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
  const contasDeAnuncio = disponiveis.filter((conta) => veiculaAnuncio(conta.platform));
  const fontesDeDados = disponiveis.filter((conta) => temRecursoParaVincular(conta.platform));
  const primeira = contasDeAnuncio[0]?.id ?? fontesDeDados[0]?.id;

  const opcao = (conta: StoredDiscovery) => (
    <label key={conta.id} className="conta">
      <input type="radio" name="descobertaId" value={conta.id} defaultChecked={conta.id === primeira} required />
      <img src={MARCA_DA_PLATAFORMA[conta.platform] ?? ''} alt="" width={22} height={22} />
      <span className="conta__corpo">
        <span className="conta__nome">{conta.name}</span>
        <span className="conta__meta">
          {ROTULO_DA_PLATAFORMA[conta.platform]}
          {temRecursoParaVincular(conta.platform) ? ` · ${ROTULO_DO_RECURSO[conta.platform]}` : ''} ·{' '}
          {conta.externalId}
          {veiculaAnuncio(conta.platform) ? ` · ${conta.currency} · ${conta.timezone}` : ''}
        </span>
      </span>
    </label>
  );

  return (
    <Shell title={`Vincular conta ou fonte · ${cliente.value.name}`} organization={organization} active="/clientes">
      <div className="page__head">
        <div>
          <h1 className="page__title">Vincular conta ou fonte a {cliente.value.name}</h1>
          <p className="page__sub">
            Estas são as contas que as plataformas liberaram para você. Escolha quais pertencem a este
            cliente — nada aqui é digitado à mão.
          </p>
        </div>
      </div>

      <Feedback message={erro} tone="error" />

      {contasDeAnuncio.length + fontesDeDados.length === 0 ? (
        <div className="vazio">
          <p className="vazio__titulo">Nenhuma conta disponível ainda</p>
          <p className="vazio__texto">
            Contas e fontes aparecem aqui depois que você autoriza a plataforma. A Orla só enxerga o
            que cada plataforma devolve na autorização.
          </p>
          <Link className="btn btn--primary btn--pill" href="/comecar?passo=conectar">
            Conectar uma plataforma →
          </Link>
        </div>
      ) : (
        <form action={vincularConta} className="card">
          <div className="card__body">
            <input type="hidden" name="clientId" value={cliente.value.id} />

            {contasDeAnuncio.length > 0 ? (
              <fieldset className="contas contas--grupo">
                <legend className="card__title">Contas de anúncio</legend>
                {contasDeAnuncio.map(opcao)}
              </fieldset>
            ) : null}

            {fontesDeDados.length > 0 ? (
              <fieldset className="contas contas--grupo">
                <legend className="card__title">Fontes de dados</legend>
                {fontesDeDados.map(opcao)}
              </fieldset>
            ) : null}

            {inativas.length > 0 ? (
              <p className="quiet-link">
                {inativas.length} conta{inativas.length > 1 ? 's' : ''} inativa
                {inativas.length > 1 ? 's' : ''} na plataforma não {inativas.length > 1 ? 'são' : 'é'}{' '}
                oferecida{inativas.length > 1 ? 's' : ''} aqui.
              </p>
            ) : null}

            {contasDeAnuncio.length > 0 ? (
              <label className="check">
                <input type="checkbox" name="coletar" defaultChecked />
                Coletar métricas da conta de anúncio todo dia (fontes de dados entram na coleta assim que vinculadas)
              </label>
            ) : null}

            <div className="page__actions">
              <Link className="btn btn--pill" href={`/clientes/${cliente.value.id}/conexoes?secao=fontes`}>
                Cancelar
              </Link>
              <button className="btn btn--primary btn--pill" type="submit">
                Vincular
              </button>
            </div>
          </div>
        </form>
      )}
    </Shell>
  );
}
