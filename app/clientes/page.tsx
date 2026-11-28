import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Readiness } from '@/../app/_components/Readiness';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { carregarProntidao } from '@/../app/clientes/[id]/_dados';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { Indicador } from '@/../app/clientes/[id]/_componentes/Indicador';
import { clientesVisiveis, lerFiltroDaLista, visaoDaListaDeClientes } from '@/modules/clients/domain/painel/listaDeClientes';
import type { Veredito } from '@/modules/clients/domain/painel/prontidao';
import { podeCadastrarCliente } from '@/modules/clients/domain/painel/permissoes';
import { vocabularioDe } from '@/modules/organizations/domain/vocabulario';
import { ORGANIZACAO_INTEIRA, escopoDeCliente } from '@/shared/db/escopo';
import { requireContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const LIMITE_DE_PRONTIDAO = 30;
const LOTE_DE_PRONTIDAO = 4;

type RawBusca = { situacao?: string | readonly string[]; busca?: string | readonly string[]; lista?: string | readonly string[] };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<RawBusca> }) {
  const contexto = await requireContext();
  const organization = contexto.organization;
  const filtro = lerFiltroDaLista(await searchParams);

  const [todosClientes, connections, accounts] = await Promise.all([
    modules().clients.list(organization.id),
    modules().connections.listConnections(organization.id),
    modules().connections.listAccounts(organization.id),
  ]);
  const vocabulario = vocabularioDe(organization.type);
  const noun = vocabulario.clientes;
  const substantivo = vocabulario.cliente;
  const ehAnunciante = organization.type === 'advertiser';
  if (ehAnunciante && todosClientes.length === 1 && !filtro.situacao && !filtro.busca && !filtro.arquivados && (await escopoDeCliente(organization.id)) === ORGANIZACAO_INTEIRA) {
    redirect(`/clientes/${todosClientes[0]!.id}`);
  }

  const vereditos = new Map<string, Veredito>();
  const paraAvaliar = filtro.arquivados ? [] : clientesVisiveis(todosClientes, filtro).slice(0, LIMITE_DE_PRONTIDAO);
  for (let i = 0; i < paraAvaliar.length; i += LOTE_DE_PRONTIDAO) {
    await Promise.all(
      paraAvaliar.slice(i, i + LOTE_DE_PRONTIDAO).map(async (client) => {
        const prontidao = await carregarProntidao(organization.id, client.id, contexto.role);
        if (prontidao) vereditos.set(client.id, prontidao.veredito);
      }),
    );
  }
  const visao = visaoDaListaDeClientes(todosClientes, filtro, vereditos, substantivo, noun);

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

      {visao.temCadastro ? (
        <div className="filtros">
          <div className="filtros__linha">
            <span className="filtros__rotulo">Situação</span>
            {visao.chips.map((chip) => (
              <Link key={chip.chave} className={`chip ${chip.ativo ? 'chip--ativo' : ''}`} href={chip.href} aria-current={chip.ativo ? 'page' : undefined}>
                {chip.rotulo} <span className="chip__n">{chip.total}</span>
              </Link>
            ))}
            {visao.limpar ? (
              <Link className="chip chip--limpar" href={visao.limpar}>
                limpar
              </Link>
            ) : null}
          </div>
          <form className="filtros__linha" action="/clientes" method="get">
            <span className="filtros__rotulo">Busca</span>
            {filtro.situacao ? <input type="hidden" name="situacao" value={filtro.situacao} /> : null}
            {filtro.arquivados ? <input type="hidden" name="lista" value="arquivados" /> : null}
            <input
              className="input filtros__busca"
              type="search"
              name="busca"
              defaultValue={filtro.busca}
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
        {visao.temCadastro ? (
          <div className="lista-clientes__barra">
            <span className="lista-clientes__titulo">{visao.tituloDaLista}</span>
            {visao.arquivados.total > 0 || visao.arquivados.ativo ? (
              <Link
                className={`botao-icone${visao.arquivados.ativo ? ' botao-icone--ativo' : ''}`}
                href={visao.arquivados.href}
                aria-current={visao.arquivados.ativo ? 'page' : undefined}
                aria-label={visao.arquivados.rotulo}
                title={visao.arquivados.rotulo}
              >
                <Icone nome="arquivo" tamanho={16} />
                <span className="botao-icone__contador">{visao.arquivados.total}</span>
              </Link>
            ) : null}
          </div>
        ) : null}
        {visao.vazio ? (
          <div className="empty">{visao.vazio}</div>
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
                {visao.linhas.map((linha) => (
                  <tr key={linha.id} className="linha-clicavel">
                    <td>
                      {linha.filial ? <span className="subtle">└ </span> : null}
                      <Link className="strong linha-clicavel__link" href={linha.href}>
                        {linha.nome}
                      </Link>
                    </td>
                    <td className="muted">{linha.segmento}</td>
                    <td>{linha.modelo}</td>
                    <td className="num">{linha.contas}</td>
                    <td>
                      <Indicador tom={linha.situacao.tom} rotulo={linha.situacao.rotulo} />
                    </td>
                    <td>{linha.prontidao ? <Indicador tom={linha.prontidao.tom} rotulo={linha.prontidao.rotulo} icone={linha.prontidao.icone} /> : <span className="subtle">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
