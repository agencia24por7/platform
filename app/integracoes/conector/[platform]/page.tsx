import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Shell } from '@/../app/_components/Shell';
import { Marca } from '@/../app/_components/Marca';
import { Feedback } from '@/../app/_components/Feedback';
import { modules } from '@/composition';
import {
  PARA_QUE_SERVE,
  Platform,
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_RECURSO,
  temRecursoParaVincular,
  veiculaAnuncio,
  type Connection,
} from '@/modules/connections/domain/connection';
import { falaOauth, isConfigured } from '@/modules/connections/domain/oauth';
import { credenciaisDaPlataforma } from '@/modules/connections/application/credenciaisOauth';
import { usaChaveDeApi } from '@/modules/connections/domain/chaveDeApi';
import { agruparPorAdministradora } from '@/modules/connections/domain/carteira';
import { requireContext } from '@/shared/http/currentOrganization';
import { canAdminister, canOperate } from '@/modules/identity/domain/user';
import {
  aceitarConvite,
  convidarParaMcc,
  desvincularRecurso,
  guardarChave,
  removerChave,
  vincularAlcancavel,
  vincularRecurso,
} from '@/../app/integracoes/acoes';
import { env } from '@/shared/config/env';

export const dynamic = 'force-dynamic';

const PONTO_DO_ESTADO: Record<Connection['status'], string> = {
  active: 'dot--ok',
  expiring: 'dot--warn',
  degraded: 'dot--warn',
  reauth_pending: 'dot--warn',
  revoked: 'dot--danger',
};

const GRANT_LABEL: Record<string, string> = {
  mcc: 'MCC da organização',
  bm_partner: 'Parceria entre BMs',
  system_user: 'Usuário do sistema',
  oauth_user: 'OAuth direto',
  api_key: 'Chave de API',
};

function plataformaValida(valor: string): Platform | null {
  const todas = Object.values(Platform) as readonly string[];
  return todas.includes(valor) ? (valor as Platform) : null;
}

export default async function ConectorPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<{ aviso?: string }>;
}) {
  const { platform } = await params;
  const plataforma = plataformaValida(platform);
  if (!plataforma) notFound();

  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  const organization = ctx.organization;
  const agencia = organization.type === 'agency';
  const podeVincular = canOperate(ctx.role);
  const { aviso } = await searchParams;

  const voltarPara = `/integracoes/conector/${plataforma}`;

  const [todasConexoes, todasContas, todasAlcancaveis, tarefas, clientes] = await Promise.all([
    modules().connections.listConnections(organization.id),
    modules().connections.listAccounts(organization.id),
    modules().discoveredAccounts.listAll(organization.id),
    modules().tasks.listRecentes(organization.id),
    modules().clients.list(organization.id),
  ]);

  const conexoes = todasConexoes.filter((conexao) => conexao.platform === plataforma);
  const accounts = todasContas.filter((conta) => conta.platform === plataforma);
  const alcancaveis = todasAlcancaveis.filter((conta) => conta.platform === plataforma);

  const convitesEnviados = tarefas.filter((tarefa) => tarefa.kind === 'mcc_invite');
  const aceitesPedidos = new Set(
    tarefas.filter((tarefa) => tarefa.kind === 'mcc_accept').map((tarefa) => tarefa.targetExternalId),
  );

  const administradoras = agruparPorAdministradora(alcancaveis).filter(
    (caminho) => caminho.administradora !== null,
  );
  const vinculadas = new Set(accounts.map((conta) => conta.externalId));
  const administradorasConhecidas = new Set(
    administradoras.map((caminho) => caminho.administradora as string),
  );
  const porConexao = new Map(todasConexoes.map((conexao) => [conexao.id, conexao]));

  const paraConectar = alcancaveis.filter(
    (conta) => !vinculadas.has(conta.externalId) && !administradorasConhecidas.has(conta.externalId),
  );
  const clientesAtivos = clientes.filter((cliente) => cliente.status === 'active');
  const clienteUnico = clientesAtivos.length === 1 ? clientesAtivos[0]!.id : '';
  const substantivo = agencia ? 'cliente' : 'negócio';

  const recursosPendentes = temRecursoParaVincular(plataforma)
    ? alcancaveis.filter((recurso) => recurso.state === 'discovered')
    : [];
  const recursosVinculados = temRecursoParaVincular(plataforma)
    ? alcancaveis.filter((recurso) => recurso.state === 'linked')
    : [];
  const clientesPorId = new Map(clientes.map((cliente) => [cliente.id, cliente]));

  const oauth = falaOauth(plataforma);
  const pronto = oauth && isConfigured(credenciaisDaPlataforma(plataforma), plataforma);

  return (
    <Shell title={ROTULO_DA_PLATAFORMA[plataforma]} organization={organization} active="/integracoes">
      <div className="page__head">
        <div>
          <div className="page__title">
            <Link href="/integracoes">Conexões</Link> · {ROTULO_DA_PLATAFORMA[plataforma]}
          </div>
          <div className="page__sub">{PARA_QUE_SERVE[plataforma]}</div>
        </div>
      </div>

      <Feedback message={aviso} tone="info" />

      <section className="fornecedor">
        <header className="fornecedor__head">
          <span className="fornecedor__marca">
            <Marca platform={plataforma} />
          </span>
          <span className="fornecedor__quem">
            <span className="fornecedor__nome">{ROTULO_DA_PLATAFORMA[plataforma]}</span>
            <span className="fornecedor__sub">
              {conexoes.length === 0 ? 'nenhuma conexão' : `${conexoes.length} conexão(ões)`}
            </span>
          </span>
          <span className="fornecedor__estado">
            {conexoes.map((conexao) => (
              <Link key={conexao.id} className="autorizacao" href={`/integracoes/${conexao.id}`}>
                <span className={`dot ${PONTO_DO_ESTADO[conexao.status]}`} />
                <span className="autorizacao__quem">
                  {conexao.accountEmail ?? conexao.externalId}
                </span>
              </Link>
            ))}
            {oauth ? (
              pronto ? (
                <Link
                  className="btn btn--compacto"
                  href={`/api/oauth/${plataforma}/start?returnTo=${encodeURIComponent(voltarPara)}`}
                >
                  {conexoes.length > 0 ? 'Autorizar outra conta' : 'Autorizar'}
                </Link>
              ) : (
                <span className="pill pill--warn">falta configurar o app</span>
              )
            ) : null}
          </span>
        </header>

        {conexoes.length > 0 ? (
          <div className="fornecedor__corpo">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Conexão</th>
                    <th>Caminho</th>
                    <th>Estado</th>
                    <th>Autorizada em</th>
                    {usaChaveDeApi(plataforma) && canAdminister(ctx.role) ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {conexoes.map((conexao) => (
                    <tr key={conexao.id}>
                      <td>
                        <Link href={`/integracoes/${conexao.id}`}>
                          <span className="strong">
                            {conexao.accountEmail ?? conexao.externalId}
                          </span>
                        </Link>
                      </td>
                      <td className="muted">{GRANT_LABEL[conexao.grantType] ?? conexao.grantType}</td>
                      <td>
                        <span className="row">
                          <span className={`dot ${PONTO_DO_ESTADO[conexao.status]}`} />
                          {conexao.status}
                        </span>
                      </td>
                      <td className="muted">{conexao.authorizedAt.toLocaleString('pt-BR')}</td>
                      {usaChaveDeApi(plataforma) && canAdminister(ctx.role) ? (
                        <td>
                          <form action={removerChave}>
                            <input type="hidden" name="connectionId" value={conexao.id} />
                            <input type="hidden" name="voltarPara" value={voltarPara} />
                            <button className="btn btn--compacto" type="submit">
                              Excluir
                            </button>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {plataforma === 'meta' ? (
        <div className="aviso">
          Cada cliente autoriza com a conta de Facebook dele, e as contas de anúncio que aquela
          pessoa administra passam a ser alcançáveis. Para funcionar com quem não tem papel no app,
          a Meta exige o app em modo Live com App Review aprovado para
          <span className="mono"> ads_read</span>,<span className="mono"> ads_management</span>,
          <span className="mono"> business_management</span> e
          <span className="mono"> leads_retrieval</span>.
        </div>
      ) : null}

      {usaChaveDeApi(plataforma) ? (
        canAdminister(ctx.role) ? (
          <section className="fornecedor">
            <form className="form--linha" action={guardarChave}>
              <input type="hidden" name="plataforma" value={plataforma} />
              <input type="hidden" name="voltarPara" value={voltarPara} />
              {plataforma === 'zapi' ? (
                <>
                  <label className="field">
                    <span className="field__label">ID da instância</span>
                    <input className="input" type="text" name="instanceId" required autoComplete="off" />
                  </label>
                  <label className="field">
                    <span className="field__label">Token da instância</span>
                    <input
                      className="input"
                      type="password"
                      name="token"
                      required
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="field__hint">
                      Testamos contra o Z-API antes de guardar — a instância precisa estar
                      conectada a um WhatsApp.
                    </span>
                  </label>
                </>
              ) : (
                <label className="field">
                  <span className="field__label">
                    {plataforma === 'rdstation' ? 'Token do usuário' : 'Chave de API'}
                  </span>
                  <input
                    className="input"
                    type="password"
                    name="chave"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={plataforma === 'rdstation' ? 'token do CRM' : 'apify_api_...'}
                  />
                  <span className="field__hint">
                    {plataforma === 'rdstation'
                      ? 'Pegue em Configurações › Integrações › Token de API, dentro do RD Station CRM. Testamos contra a conta antes de guardar.'
                      : 'Testamos contra a Apify antes de guardar. O banco fica só com a referência e as quatro primeiras e últimas letras, para você reconhecê-la depois.'}
                  </span>
                </label>
              )}
              <button className="btn btn--primary" type="submit">
                Testar e guardar no cofre
              </button>
            </form>
          </section>
        ) : (
          <div className="empty">Só quem administra a organização pode guardar uma chave.</div>
        )
      ) : null}

      {plataforma === 'zapi' && conexoes.length > 0 && canAdminister(ctx.role) ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">URL do webhook</span>
            <span className="card__sub">cole isso na configuração de webhook da instância no Z-API</span>
          </div>
          <div className="fornecedor__corpo">
            {conexoes.map((conexao) =>
              conexao.webhookToken ? (
                <div key={conexao.id} className="mono subtle">
                  {env().TRIA_APP_BASE_URL}/api/webhooks/zapi/{conexao.webhookToken}
                </div>
              ) : null,
            )}
          </div>
        </div>
      ) : null}

      {plataforma === 'google' ? (
        <div className="card">
          <div className="card__head">
            <span className="card__title">Administradoras</span>
            <span className="card__sub">
              {administradoras.length === 0
                ? 'nenhuma MCC no caminho das suas autorizações'
                : `${administradoras.length} MCC · não veiculam campanha, abrem acesso`}
            </span>
          </div>

          {administradoras.length === 0 ? (
            <div className="empty">
              Autorize com a conta que administra sua MCC para enxergá-la aqui.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Administradora</th>
                    <th className="num">Contas sob ela</th>
                    <th className="num">Vinculadas</th>
                    <th>Autorização que alcança</th>
                  </tr>
                </thead>
                <tbody>
                  {administradoras.map((caminho) => {
                    const conexao = porConexao.get(caminho.contas[0]?.connectionId ?? '');
                    return (
                      <tr key={caminho.administradora}>
                        <td>
                          <span className="mono strong">{caminho.administradora}</span>
                        </td>
                        <td className="num">{caminho.contas.length}</td>
                        <td className="num">{caminho.vinculadas}</td>
                        <td className="subtle">
                          {conexao ? (
                            <Link href={`/integracoes/${conexao.id}`}>
                              {conexao.accountEmail ?? conexao.externalId}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {veiculaAnuncio(plataforma) ? (
        <>
          <div className="card">
            <div className="card__head">
              <span className="card__title">Contas</span>
              <span className="card__sub">{accounts.length} vinculada(s)</span>
            </div>
            {accounts.length === 0 ? (
              <div className="empty">Nenhuma conta vinculada ainda.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Conta</th>
                      <th>{agencia ? 'Cliente' : 'Negócio'}</th>
                      <th>Coleta</th>
                      <th>Última coleta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((conta) => (
                      <tr key={conta.id}>
                        <td>
                          <div className="strong">{conta.name}</div>
                          <div className="mono subtle">{conta.externalId}</div>
                        </td>
                        <td>
                          <Link href={`/clientes/${conta.clientId}`}>{conta.clientName}</Link>
                        </td>
                        <td>
                          <span className={`pill ${conta.syncEnabled ? 'pill--ok' : ''}`}>
                            {conta.syncEnabled ? 'Ligada' : 'Pausada'}
                          </span>
                        </td>
                        <td className="muted">
                          {conta.lastSyncAt ? conta.lastSyncAt.toLocaleString('pt-BR') : 'nunca'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__head">
              <span className="card__title">Conectar conta</span>
              <span className="card__sub">
                {paraConectar.length === 0
                  ? 'tudo o que você alcança já está vinculado'
                  : `${paraConectar.length} conta(s) ao seu alcance, ainda sem ${substantivo}`}
              </span>
            </div>

            {paraConectar.length === 0 ? (
              <div className="empty">
                As contas aparecem aqui depois que você autoriza a plataforma. A Orla só enxerga o
                que o Google ou a Meta devolvem.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Conta</th>
                      <th>Onde está</th>
                      <th>{agencia ? 'Cliente' : 'Negócio'}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {paraConectar.map((conta) => {
                      const sobMcc =
                        conta.managerExternalId && conta.managerExternalId !== conta.externalId
                          ? conta.managerExternalId
                          : null;
                      const convite = convitesEnviados.find(
                        (item) => item.targetExternalId === conta.externalId,
                      );
                      const mccDisponivel = administradoras[0]?.administradora ?? null;

                      return (
                        <tr key={conta.id}>
                          <td>
                            <div className="strong">{conta.name}</div>
                            <div className="mono subtle">
                              {conta.externalId} · {conta.currency}
                            </div>
                            {conta.inactive ? (
                              <span className="pill pill--warn">inativa na plataforma</span>
                            ) : null}
                          </td>
                          <td>
                            {sobMcc ? (
                              <span className="mono subtle">sob {sobMcc}</span>
                            ) : convite && aceitesPedidos.has(conta.externalId) ? (
                              <span className="subtle">aceite enfileirado</span>
                            ) : convite && convite.status === 'done' ? (
                              <form className="form--inline" action={aceitarConvite}>
                                <input type="hidden" name="conviteId" value={convite.id} />
                                <input type="hidden" name="voltarPara" value={voltarPara} />
                                <select
                                  className="select select--compacto"
                                  name="conexaoDaConta"
                                  required
                                >
                                  <option value="">autorização da conta…</option>
                                  {conexoes.map((conexao) => (
                                    <option key={conexao.id} value={conexao.id}>
                                      {conexao.accountEmail ?? conexao.externalId}
                                    </option>
                                  ))}
                                </select>
                                <button className="btn btn--compacto" type="submit">
                                  Aceitar convite
                                </button>
                              </form>
                            ) : convite ? (
                              <span className="subtle">convite a caminho do Google</span>
                            ) : agencia && mccDisponivel && canAdminister(ctx.role) ? (
                              <form action={convidarParaMcc}>
                                <input type="hidden" name="contaId" value={conta.id} />
                                <input type="hidden" name="administradora" value={mccDisponivel} />
                                <input type="hidden" name="voltarPara" value={voltarPara} />
                                <button className="btn btn--compacto" type="submit">
                                  Convidar para a MCC
                                </button>
                              </form>
                            ) : (
                              <span className="subtle">acesso direto</span>
                            )}
                          </td>
                          <td colSpan={2}>
                            {!podeVincular ? (
                              <span className="subtle">seu papel não vincula contas</span>
                            ) : clientesAtivos.length === 0 ? (
                              <span className="row">
                                <span className="subtle">
                                  toda conta tem dono: cadastre um {substantivo} para vincular
                                </span>
                                <Link className="btn btn--compacto" href="/clientes/novo">
                                  Cadastrar {substantivo}
                                </Link>
                              </span>
                            ) : (
                              <form className="form--inline" action={vincularAlcancavel}>
                                <input type="hidden" name="contaId" value={conta.id} />
                                <input type="hidden" name="voltarPara" value={voltarPara} />
                                <select
                                  className="select select--compacto"
                                  name="clientId"
                                  defaultValue={clienteUnico}
                                  required
                                  aria-label={`${agencia ? 'Cliente' : 'Negócio'} dono de ${conta.name}`}
                                >
                                  <option value="">escolher {substantivo}…</option>
                                  {clientesAtivos.map((cliente) => (
                                    <option key={cliente.id} value={cliente.id}>
                                      {cliente.name}
                                    </option>
                                  ))}
                                </select>
                                <label className="checkline">
                                  <input type="checkbox" name="semColeta" />
                                  sem coletar agora
                                </label>
                                <button className="btn btn--primary btn--compacto" type="submit">
                                  Vincular
                                </button>
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      {temRecursoParaVincular(plataforma) ? (
        <>
          <div className="card">
            <div className="card__head">
              <span className="card__title">{ROTULO_DO_RECURSO[plataforma]}s vinculados</span>
              <span className="card__sub">{recursosVinculados.length} vinculado(s)</span>
            </div>
            {recursosVinculados.length === 0 ? (
              <div className="empty">Nenhum {ROTULO_DO_RECURSO[plataforma].toLowerCase()} vinculado ainda.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{ROTULO_DO_RECURSO[plataforma]}</th>
                      <th>{agencia ? 'Cliente' : 'Negócio'}</th>
                      {podeVincular ? <th aria-label="Ações" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {recursosVinculados.map((recurso) => (
                      <tr key={recurso.id}>
                        <td>
                          <div className="strong">{recurso.name}</div>
                          <div className="mono subtle">{recurso.externalId}</div>
                        </td>
                        <td>
                          {recurso.clientId && clientesPorId.get(recurso.clientId) ? (
                            <Link href={`/clientes/${recurso.clientId}`}>
                              {clientesPorId.get(recurso.clientId)!.name}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        {podeVincular ? (
                          <td>
                            <form className="form--inline" action={desvincularRecurso}>
                              <input type="hidden" name="recursoId" value={recurso.id} />
                              <input type="hidden" name="voltarPara" value={voltarPara} />
                              <button className="btn btn--compacto" type="submit">
                                Desvincular
                              </button>
                            </form>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__head">
              <span className="card__title">Conectar {ROTULO_DO_RECURSO[plataforma].toLowerCase()}</span>
              <span className="card__sub">
                {recursosPendentes.length === 0
                  ? 'tudo o que você alcança já está vinculado'
                  : `${recursosPendentes.length} ${ROTULO_DO_RECURSO[plataforma].toLowerCase()}(s) ao seu alcance, ainda sem ${substantivo}`}
              </span>
            </div>

            {recursosPendentes.length === 0 ? (
              <div className="empty">
                Os recursos aparecem aqui depois que você autoriza a plataforma.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{ROTULO_DO_RECURSO[plataforma]}</th>
                      <th>{agencia ? 'Cliente' : 'Negócio'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recursosPendentes.map((recurso) => (
                      <tr key={recurso.id}>
                        <td>
                          <div className="strong">{recurso.name}</div>
                          <div className="mono subtle">{recurso.externalId}</div>
                        </td>
                        <td>
                          {!podeVincular ? (
                            <span className="subtle">seu papel não vincula recursos</span>
                          ) : clientesAtivos.length === 0 ? (
                            <span className="row">
                              <span className="subtle">
                                todo recurso tem dono: cadastre um {substantivo} para vincular
                              </span>
                              <Link className="btn btn--compacto" href="/clientes/novo">
                                Cadastrar {substantivo}
                              </Link>
                            </span>
                          ) : (
                            <form className="form--inline" action={vincularRecurso}>
                              <input type="hidden" name="recursoId" value={recurso.id} />
                              <input type="hidden" name="voltarPara" value={voltarPara} />
                              <select
                                className="select select--compacto"
                                name="clientId"
                                defaultValue={clienteUnico}
                                required
                                aria-label={`${agencia ? 'Cliente' : 'Negócio'} dono de ${recurso.name}`}
                              >
                                <option value="">escolher {substantivo}…</option>
                                {clientesAtivos.map((cliente) => (
                                  <option key={cliente.id} value={cliente.id}>
                                    {cliente.name}
                                  </option>
                                ))}
                              </select>
                              <button className="btn btn--primary btn--compacto" type="submit">
                                Vincular
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </Shell>
  );
}
