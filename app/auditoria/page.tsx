import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import {
  acoesPresentes,
  celulaDe,
  colunasDeMetadados,
  familiaDe,
  indicadoresDaTrilha,
  resumoPorFamilia,
} from '@/modules/audit/domain/auditView';
import { requireContext } from '@/shared/http/currentOrganization';
import { canAdminister } from '@/modules/identity/domain/user';

export const dynamic = 'force-dynamic';

const PERIODOS = [
  { valor: '', rotulo: 'Desde sempre', horas: null },
  { valor: '1h', rotulo: 'Última hora', horas: 1 },
  { valor: '24h', rotulo: 'Últimas 24 horas', horas: 24 },
  { valor: '7d', rotulo: 'Últimos 7 dias', horas: 24 * 7 },
  { valor: '30d', rotulo: 'Últimos 30 dias', horas: 24 * 30 },
] as const;

const AUTORES = ['user', 'agent', 'worker', 'system'] as const;
const LIMITES = [50, 100, 250, 500] as const;

type Busca = {
  evento?: string;
  familia?: string;
  autor?: string;
  periodo?: string;
  limite?: string;
};

function instanteDe(periodo: string | undefined): Date | null {
  const escolhido = PERIODOS.find((item) => item.valor === periodo);
  if (!escolhido?.horas) return null;
  return new Date(Date.now() - escolhido.horas * 3600_000);
}

function comFiltro(atual: Busca, mudanca: Partial<Busca>): string {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries({ ...atual, ...mudanca })) {
    if (valor) params.set(chave, String(valor));
  }
  const query = params.toString();
  return query ? `/auditoria?${query}` : '/auditoria';
}

export default async function Auditoria({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  const organization = ctx.organization;
  const veOrigem = canAdminister(ctx.role);

  const busca = await searchParams;
  const limite = LIMITES.includes(Number(busca.limite) as (typeof LIMITES)[number])
    ? Number(busca.limite)
    : 100;

  const [entradas, universo] = await Promise.all([
    modules().audit.search(organization.id, {
      action: busca.evento || null,
      family: busca.familia || null,
      actorType: busca.autor || null,
      since: instanteDe(busca.periodo),
      limit: limite,
    }),
    modules().audit.list(organization.id, 500),
  ]);

  const colunas = colunasDeMetadados(entradas);
  const eventos = acoesPresentes(universo);
  const familias = resumoPorFamilia(universo);
  const indicadores = indicadoresDaTrilha(universo, new Date());
  const filtrando = Boolean(busca.evento || busca.familia || busca.autor || busca.periodo);

  return (
    <Shell title="Trilha de auditoria" organization={organization} active="/auditoria">
      <div className="page__head">
        <div>
          <h1 className="page__title">Trilha de auditoria</h1>
          <p className="page__sub">
            Append-only: o app não tem permissão de <code>UPDATE</code> nem <code>DELETE</code> nesta
            tabela. Cada evento guarda quem fez, de onde, em qual requisição e sobre o quê.
          </p>
        </div>
      </div>

      <section className="kpis" aria-label="Indicadores das últimas 24 horas">
        <div className="kpi">
          <span className="kpi__rotulo">Eventos em 24 h</span>
          <span className="kpi__valor">
            {indicadores.eventos}
            {indicadores.cobreJanelaInteira ? '' : '+'}
          </span>
          <span className="kpi__nota">
            {indicadores.ultimoEvento
              ? `último em ${indicadores.ultimoEvento.toLocaleString('pt-BR')}`
              : 'nenhum evento registrado'}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi__rotulo">Atores distintos</span>
          <span className="kpi__valor">{indicadores.atoresDistintos}</span>
          <span className="kpi__nota">pessoas, agentes e rotinas</span>
        </div>
        <div className="kpi">
          <span className="kpi__rotulo">Automação</span>
          <span className="kpi__valor">{indicadores.percentualAutomatizado}%</span>
          <span className="kpi__nota">{indicadores.automatizados} sem autor humano</span>
        </div>
        <div className="kpi">
          <span className="kpi__rotulo">Alertas e falhas</span>
          <span className="kpi__valor">{indicadores.alertasEFalhas}</span>
          <span className={`pill ${indicadores.alertasEFalhas > 0 ? 'pill--warn' : 'pill--ok'}`}>
            {indicadores.alertasEFalhas > 0 ? '⚠ requer atenção' : '✓ sem ocorrências'}
          </span>
        </div>
      </section>
      {indicadores.cobreJanelaInteira ? null : (
        <p className="subtle">Os indicadores usam os 500 eventos mais recentes; o total pode ser maior.</p>
      )}

      <div className="filtros">
        <div className="filtros__linha">
          <span className="filtros__rotulo">Família</span>
          <Link
            className={`chip ${!busca.familia ? 'chip--ativo' : ''}`}
            href={comFiltro(busca, { familia: '', evento: '' })}
          >
            todas <span className="chip__n">{universo.length}</span>
          </Link>
          {familias.map((item) => (
            <Link
              key={item.familia}
              className={`chip ${busca.familia === item.familia ? 'chip--ativo' : ''}`}
              href={comFiltro(busca, { familia: item.familia, evento: '' })}
            >
              {item.familia} <span className="chip__n">{item.total}</span>
            </Link>
          ))}
        </div>

        <div className="filtros__linha">
          <span className="filtros__rotulo">Autor</span>
          <Link
            className={`chip ${!busca.autor ? 'chip--ativo' : ''}`}
            href={comFiltro(busca, { autor: '' })}
          >
            todos
          </Link>
          {AUTORES.map((autor) => (
            <Link
              key={autor}
              className={`chip ${busca.autor === autor ? 'chip--ativo' : ''}`}
              href={comFiltro(busca, { autor })}
            >
              {autor}
            </Link>
          ))}
        </div>

        <div className="filtros__linha">
          <span className="filtros__rotulo">Período</span>
          {PERIODOS.map((item) => (
            <Link
              key={item.valor || 'sempre'}
              className={`chip ${(busca.periodo ?? '') === item.valor ? 'chip--ativo' : ''}`}
              href={comFiltro(busca, { periodo: item.valor })}
            >
              {item.rotulo}
            </Link>
          ))}
        </div>

        <div className="filtros__linha">
          <span className="filtros__rotulo">Evento</span>
          <Link
            className={`chip ${!busca.evento ? 'chip--ativo' : ''}`}
            href={comFiltro(busca, { evento: '' })}
          >
            todos
          </Link>
          {eventos
            .filter((evento) => !busca.familia || familiaDe(evento) === busca.familia)
            .map((evento) => (
              <Link
                key={evento}
                className={`chip chip--mono ${busca.evento === evento ? 'chip--ativo' : ''}`}
                href={comFiltro(busca, { evento })}
              >
                {evento}
              </Link>
            ))}
        </div>

        <div className="filtros__linha">
          <span className="filtros__rotulo">Linhas</span>
          {LIMITES.map((valor) => (
            <Link
              key={valor}
              className={`chip ${limite === valor ? 'chip--ativo' : ''}`}
              href={comFiltro(busca, { limite: String(valor) })}
            >
              {valor}
            </Link>
          ))}
          {filtrando ? (
            <Link className="chip chip--limpar" href="/auditoria">
              limpar filtros
            </Link>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">
            {entradas.length} evento{entradas.length === 1 ? '' : 's'}
          </span>
          <span className="card__sub">
            {colunas.length > 0
              ? `${colunas.length} campo(s) de metadado como coluna`
              : 'sem metadados nestes eventos'}
          </span>
        </div>

        {entradas.length === 0 ? (
          <div className="empty">Nenhum evento com esses filtros.</div>
        ) : (
          <div className="table-wrap" role="region" aria-label="Eventos de auditoria" tabIndex={0}>
            <table className="table table--auditoria">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Evento</th>
                  <th>Autor</th>
                  <th>Alvo</th>
                  <th>Requisição</th>
                  {veOrigem ? <th>Origem</th> : null}
                  {colunas.map((coluna) => (
                    <th key={coluna.chave} className={coluna.numerica ? 'num' : undefined}>
                      {coluna.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entradas.map((entrada) => (
                  <tr key={entrada.id}>
                    <td className="nowrap">
                      <div>{entrada.occurredAt.toLocaleString('pt-BR')}</div>
                      <div className="mono subtle">
                        {entrada.occurredAt.toISOString().slice(11, 23)}
                      </div>
                    </td>
                    <td className="nowrap">
                      <span className="mono strong">{entrada.action}</span>
                    </td>
                    <td>
                      <span className="pill">{entrada.actorType}</span>
                      {entrada.actorId ? (
                        <div className="mono subtle" title={entrada.actorId}>
                          {entrada.actorId.slice(0, 8)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div>{entrada.targetType ?? '—'}</div>
                      {entrada.targetId ? (
                        <div className="mono subtle" title={entrada.targetId}>
                          {entrada.targetId.slice(0, 8)}
                        </div>
                      ) : null}
                    </td>
                    <td className="mono subtle" title={entrada.requestId ?? ''}>
                      {entrada.requestId ? entrada.requestId.slice(0, 8) : '—'}
                    </td>
                    {veOrigem ? <td className="mono subtle">{entrada.sourceIp ?? '—'}</td> : null}

                    {colunas.map((coluna) => {
                      const celula = celulaDe((entrada.metadata ?? {})[coluna.chave]);
                      return (
                        <td key={coluna.chave} className={coluna.numerica ? 'num' : undefined}>
                          {celula.tipo === 'vazio' ? <span className="subtle">—</span> : null}
                          {celula.tipo === 'booleano' ? (
                            <span className={`pill ${celula.verdadeiro ? 'pill--ok' : ''}`}>
                              {celula.verdadeiro ? 'sim' : 'não'}
                            </span>
                          ) : null}
                          {celula.tipo === 'lista' ? (
                            <div className="fichas">
                              {celula.itens.map((item) => (
                                <span key={item} className="ficha">
                                  {item}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {celula.tipo === 'texto' ? <span>{celula.valor}</span> : null}
                        </td>
                      );
                    })}
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
