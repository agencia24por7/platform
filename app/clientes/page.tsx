import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Readiness } from '@/../app/_components/Readiness';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import type { ClientWithAccounts } from '@/modules/clients/domain/client';
import { carregarProntidao } from '@/../app/clientes/[id]/_dados';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { ROTULO_DO_VEREDITO, type Veredito } from '@/modules/clients/domain/painel/prontidao';
import { podeCadastrarCliente } from '@/modules/clients/domain/painel/permissoes';
import { vocabularioDe } from '@/modules/organizations/domain/vocabulario';
import { ORGANIZACAO_INTEIRA, escopoDeCliente } from '@/shared/db/escopo';
import { requireContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const LIMITE_DE_PRONTIDAO = 30;
const LOTE_DE_PRONTIDAO = 4;
const CLASSE_DO_VEREDITO: Record<Veredito, string> = { sim: 'pill--ok', parcial: 'pill--warn', nao: 'pill--danger' };
const ICONE_DO_VEREDITO = { sim: 'ok', parcial: 'parcial', nao: 'nao' } as const;

const SITUACOES = [
  { valor: 'active', rotulo: 'Ativo', pill: 'pill--ok' },
  { valor: 'paused', rotulo: 'Pausado', pill: 'pill--warn' },
  { valor: 'archived', rotulo: 'Arquivado', pill: '' },
] as const;

function situacaoDe(status: ClientWithAccounts['status']) {
  return SITUACOES.find((item) => item.valor === status) ?? SITUACOES[0];
}

function comFiltro(atual: Busca, mudanca: Partial<Busca>): string {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries({ ...atual, ...mudanca })) {
    if (valor) params.set(chave, String(valor));
  }
  const query = params.toString();
  return query ? `/clientes?${query}` : '/clientes';
}

type RawBusca = { situacao?: string | readonly string[]; busca?: string | readonly string[] };
type Busca = { situacao?: string; busca?: string };

function primeiro(valor: string | readonly string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : (valor as string | undefined);
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<RawBusca> }) {
  const contexto = await requireContext();
  const organization = contexto.organization;

  const bruto = await searchParams;
  const filtro: Busca = { situacao: primeiro(bruto.situacao), busca: primeiro(bruto.busca) };

  const [todosClientes, connections, accounts] = await Promise.all([
    modules().clients.list(organization.id),
    modules().connections.listConnections(organization.id),
    modules().connections.listAccounts(organization.id),
  ]);
  const vocabulario = vocabularioDe(organization.type);
  const noun = vocabulario.clientes;
  const substantivo = vocabulario.cliente;
  const ehAnunciante = organization.type === 'advertiser';
  if (ehAnunciante && todosClientes.length === 1 && !filtro.situacao && !filtro.busca && (await escopoDeCliente(organization.id)) === ORGANIZACAO_INTEIRA) {
    redirect(`/clientes/${todosClientes[0]!.id}`);
  }

  const termo = filtro.busca?.trim().toLowerCase() ?? '';
  const clients = todosClientes.filter((client) => {
    if (filtro.situacao && client.status !== filtro.situacao) return false;
    if (termo && !client.name.toLowerCase().includes(termo)) return false;
    return true;
  });
  const prontidoes = new Map<string, Awaited<ReturnType<typeof carregarProntidao>>>();
  const paraAvaliar = clients.filter((client) => client.status !== 'archived').slice(0, LIMITE_DE_PRONTIDAO);
  for (let i = 0; i < paraAvaliar.length; i += LOTE_DE_PRONTIDAO) {
    await Promise.all(
      paraAvaliar.slice(i, i + LOTE_DE_PRONTIDAO).map(async (client) => {
        prontidoes.set(client.id, await carregarProntidao(organization.id, client.id));
      }),
    );
  }
  const filtrando = Boolean(filtro.situacao) || termo.length > 0;

  return (
    <Shell title={noun} organization={organization} active="/clientes">
      <div className="page__head">
        <div>
          <div className="page__title">{noun}</div>
          <div className="page__sub">
            {ehAnunciante
              ? 'Cada negócio tem as próprias contas de anúncio e o próprio contexto.'
              : 'Rede e filial formam hierarquia de um nível. Cada cliente recebe contas de anúncio próprias, vinculadas a uma autorização da organização.'}
          </div>
        </div>
        <div className="page__actions">
          {podeCadastrarCliente(organization.type, contexto.role) && contexto.clientIds === null ? (
            <Link className="btn btn--primary" href="/clientes/novo">
              Novo {substantivo}
            </Link>
          ) : null}
        </div>
      </div>

      <Readiness connections={connections.length} linkedAccounts={accounts.length} />

      {todosClientes.length > 0 ? (
        <div className="filtros">
          <div className="filtros__linha">
            <span className="filtros__rotulo">Situação</span>
            <Link className={`chip ${!filtro.situacao ? 'chip--ativo' : ''}`} href={comFiltro(filtro, { situacao: '' })}>
              todas <span className="chip__n">{todosClientes.length}</span>
            </Link>
            {SITUACOES.map((item) => {
              const total = todosClientes.filter((client) => client.status === item.valor).length;
              if (total === 0) return null;
              return (
                <Link
                  key={item.valor}
                  className={`chip ${filtro.situacao === item.valor ? 'chip--ativo' : ''}`}
                  href={comFiltro(filtro, { situacao: item.valor })}
                >
                  {item.rotulo} <span className="chip__n">{total}</span>
                </Link>
              );
            })}
            {filtrando ? (
              <Link className="chip chip--limpar" href="/clientes">
                limpar
              </Link>
            ) : null}
          </div>
          <form className="filtros__linha" action="/clientes" method="get">
            <span className="filtros__rotulo">Busca</span>
            {filtro.situacao ? <input type="hidden" name="situacao" value={filtro.situacao} /> : null}
            <input
              className="input filtros__busca"
              type="search"
              name="busca"
              defaultValue={filtro.busca ?? ''}
              placeholder={`Buscar por nome do ${substantivo}`}
              aria-label={`Buscar por nome do ${substantivo}`}
            />
            <button className="btn" type="submit">
              Buscar
            </button>
          </form>
        </div>
      ) : null}

      <div className="card">
        {todosClientes.length === 0 ? (
          <div className="empty">
            Nenhum cadastro ainda. Comece criando o primeiro {substantivo}.
          </div>
        ) : clients.length === 0 ? (
          <div className="empty">Nenhum {substantivo} encontrado com esse filtro.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Segmento</th>
                  <th>Modelo</th>
                  <th className="num">Contas</th>
                  <th>Situação</th>
                  <th>Pronto para planejar</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const situacao = situacaoDe(client.status);
                  return (
                    <tr key={client.id} className="linha-clicavel">
                      <td>
                        {client.parentClientId ? <span className="subtle">└ </span> : null}
                        <Link className="strong linha-clicavel__link" href={`/clientes/${client.id}`}>
                          {client.name}
                        </Link>
                      </td>
                      <td className="muted">{client.segment ?? '—'}</td>
                      <td>
                        <span className={`pill ${client.businessModel === 'ecommerce' ? 'pill--info' : 'pill--ok'}`}>
                          {client.businessModel === 'ecommerce' ? 'E-commerce' : 'Leads'}
                        </span>
                      </td>
                      <td className="num">{client.accountCount}</td>
                      <td>
                        <span className={`pill ${situacao.pill}`}>
                          <span className="dot" />
                          {situacao.rotulo}
                        </span>
                      </td>
                      <td>
                        {prontidoes.get(client.id) ? (
                          <span className={`pill ${CLASSE_DO_VEREDITO[prontidoes.get(client.id)!.veredito]}`}>
                            <Icone nome={ICONE_DO_VEREDITO[prontidoes.get(client.id)!.veredito]} tamanho={14} />
                            {ROTULO_DO_VEREDITO[prontidoes.get(client.id)!.veredito]}
                          </span>
                        ) : (
                          <span className="subtle">—</span>
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
    </Shell>
  );
}
