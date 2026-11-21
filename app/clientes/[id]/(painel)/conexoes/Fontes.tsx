import Link from 'next/link';
import { MenuMais } from '@/../app/clientes/[id]/_componentes/MenuMais';
import { Marca } from '@/../app/_components/Marca';
import { Icone, type NomeDoIcone } from '@/../app/clientes/[id]/_componentes/Icones';
import { carregarConexoes, carregarContas, carregarPainel, carregarProntidao } from '@/../app/clientes/[id]/_dados';
import {
  alternarColeta,
  desvincularContaDeAnuncio,
  desvincularFonte,
  moverConta,
  moverFonte,
} from '@/../app/clientes/[id]/(painel)/conexoes/acoes';
import { modules } from '@/composition';
import { acaoPrincipal } from '@/modules/clients/domain/painel/prontidao';
import {
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_RECURSO,
  precisaReautorizar,
  temRecursoParaVincular,
  type Connection,
  type Platform,
} from '@/modules/connections/domain/connection';
import { atrasoDaColeta, ordenarPorProblema, situacaoDaFonte, situacaoDeRecurso, type SituacaoDaFonte, type VariacaoDoEstado } from '@/modules/clients/domain/painel/fontes';
import { tempoRelativo } from '@/modules/clients/domain/painel/resumo';

const ICONE_DA_VARIACAO: Record<VariacaoDoEstado, NomeDoIcone> = {
  ok: 'ok',
  atencao: 'atencao',
  reautorizar: 'reautorizar',
  vazio: 'vazio',
  pausada: 'pausada',
  erro: 'erro',
};

const CLASSE_DA_VARIACAO: Record<VariacaoDoEstado, string> = {
  ok: 'pill--ok',
  atencao: 'pill--warn',
  reautorizar: 'pill--danger',
  vazio: '',
  pausada: 'pill--info',
  erro: 'pill--danger',
};

type Linha = {
  readonly chave: string;
  readonly tipo: 'conta' | 'fonte';
  readonly id: string;
  readonly plataforma: Platform;
  readonly nome: string;
  readonly externalId: string;
  readonly detalhe: string;
  readonly situacao: SituacaoDaFonte;
  readonly frescor: string;
  readonly conexaoId: string | null;
  readonly conexaoRotulo: string;
  readonly coletaLigada: boolean;
};

type Grupo = {
  readonly chave: string;
  readonly conexaoId: string | null;
  readonly plataforma: Platform;
  readonly rotulo: string;
  readonly reautorizar: boolean;
  readonly linhas: Linha[];
};

function agruparPorConexao(ordenadas: readonly Linha[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const linha of ordenadas) {
    const chave = linha.conexaoId ?? `sem-${linha.chave}`;
    const existente = grupos.get(chave);
    if (existente) {
      existente.linhas.push(linha);
      continue;
    }
    grupos.set(chave, { chave, conexaoId: linha.conexaoId, plataforma: linha.plataforma, rotulo: linha.conexaoRotulo, reautorizar: linha.situacao.estado === 'reautorizar', linhas: [linha] });
  }
  return [...grupos.values()];
}

function conexaoPrecisaReautorizar(conexao: Connection | undefined): boolean {
  return conexao ? conexao.status !== 'revoked' && precisaReautorizar(conexao) : false;
}

export async function Fontes({ clienteId }: { readonly clienteId: string }) {
  const { ctx, cliente, podeEditar, organizacaoInteira } = await carregarPainel(clienteId);
  const [[contas, fontes], irmaos, conexoes] = await Promise.all([
    carregarContas(ctx.organization.id, cliente.id),
    modules().clients.list(ctx.organization.id),
    carregarConexoes(ctx.organization.id),
  ]);
  const prontidao = await carregarProntidao(ctx.organization.id, cliente.id);
  const principal = prontidao ? acaoPrincipal(prontidao.acoes, cliente.id, { podeEditar, organizacaoInteira, tipo: ctx.organization.type }) : null;
  const cabecalhoTemConexao = principal?.ehConexao === true;
  const agora = new Date();
  const destinos = irmaos.filter((item) => item.id !== cliente.id);
  const destinosAtivos = destinos.filter((item) => item.status === 'active');
  const conexaoPorId = new Map(conexoes.map((c) => [c.id, c]));

  const linhas: Linha[] = [
    ...contas.map((conta): Linha => {
      const conexao = conexaoPorId.get(conta.connectionId);
      const situacao = situacaoDaFonte(
        { precisaReautorizar: conexaoPrecisaReautorizar(conexao), coletaLigada: conta.syncEnabled, comErro: conta.status === 'error' || conexao?.status === 'revoked', ultimaColeta: conta.lastSyncAt },
        agora,
      );
      const atraso = conta.syncEnabled ? atrasoDaColeta(conta.lastSyncAt, agora) : null;
      return {
        chave: `conta-${conta.id}`,
        tipo: 'conta',
        id: conta.id,
        plataforma: conta.platform,
        nome: conta.name,
        externalId: conta.externalId,
        detalhe: [conexao?.label ?? 'Conexão', conta.accountGroup, conta.currency].filter(Boolean).join(' · '),
        situacao,
        frescor: conta.lastSyncAt ? `Coleta ${tempoRelativo(conta.lastSyncAt, agora)}${atraso ? ` · ${atraso}` : ''}` : 'Sem coleta ainda',
        conexaoId: conta.connectionId,
        conexaoRotulo: conexao?.label ?? 'Conexão',
        coletaLigada: conta.syncEnabled,
      };
    }),
    ...fontes.map((fonte): Linha => {
      const conexao = conexaoPorId.get(fonte.connectionId);
      return {
        chave: `fonte-${fonte.id}`,
        tipo: 'fonte',
        id: fonte.id,
        plataforma: fonte.platform,
        nome: fonte.name,
        externalId: fonte.externalId,
        detalhe: [temRecursoParaVincular(fonte.platform) ? ROTULO_DO_RECURSO[fonte.platform] : 'Fonte', conexao?.label ?? 'Conexão'].join(' · '),
        situacao: situacaoDeRecurso(conexaoPrecisaReautorizar(conexao)),
        frescor: 'Entra na coleta',
        conexaoId: fonte.connectionId,
        conexaoRotulo: conexao?.label ?? 'Conexão',
        coletaLigada: true,
      };
    }),
  ];
  const ordenadas = ordenarPorProblema(linhas);
  const grupos = agruparPorConexao(ordenadas);
  const pedemAcao = ordenadas.filter((l) => l.situacao.estado !== 'ok').length;

  return (
    <section className="pilha" aria-labelledby="t-fontes">
      <div className="fontes-topo">
        <div>
          <h2 className="card__title" id="t-fontes">
            Fontes
          </h2>
          <p className="subtle small">
            {ordenadas.length === 0 ? 'Nada conectado ainda.' : pedemAcao > 0 ? `${pedemAcao} de ${ordenadas.length} pedem ação.` : `${ordenadas.length} em dia.`}
          </p>
        </div>
        {podeEditar && !cabecalhoTemConexao ? (
          <Link className="btn btn--primary" href={`/clientes/${cliente.id}/contas/nova`}>
            Conectar conta
          </Link>
        ) : null}
      </div>

      {ordenadas.length === 0 ? (
        <div className="vazio">
          <div className="vazio__titulo">Nenhuma conta ou fonte</div>
          <p className="vazio__texto">Sem conta vinculada o cliente não entra na coleta.</p>
        </div>
      ) : (
        <ul className="fontes fontes--grupos">
          {grupos.map((grupo) => (
            <li key={grupo.chave} className="grupo-fonte">
              <div className="grupo-fonte__topo">
                <Marca platform={grupo.plataforma} tamanho={28} />
                <div className="grupo-fonte__quem">
                  <span className="strong">{ROTULO_DA_PLATAFORMA[grupo.plataforma]}</span>
                  <span className="subtle xsmall">{grupo.rotulo}</span>
                </div>
                {podeEditar && organizacaoInteira && grupo.reautorizar && grupo.conexaoId ? (
                  <Link className="btn btn--compacto btn--primary" href={`/integracoes/${grupo.conexaoId}`}>
                    Reautorizar
                  </Link>
                ) : null}
              </div>
              <ul className="fontes">
          {grupo.linhas.map((linha) => (
            <li key={linha.chave} className={`fonte fonte--${linha.situacao.variacao}`}>
              <div className="fonte__quem">
                <div className="fonte__textos">
                  <span className="strong fonte__nome">{linha.nome}</span>
                  <span className="mono subtle xsmall">{linha.externalId}</span>
                </div>
              </div>
              <div className="fonte__estado">
                <span className={`pill ${CLASSE_DA_VARIACAO[linha.situacao.variacao]}`}>
                  <Icone nome={ICONE_DA_VARIACAO[linha.situacao.variacao]} tamanho={14} />
                  {linha.situacao.rotulo}
                </span>
                <span className="subtle xsmall">{linha.frescor}</span>
                <span className="subtle xsmall fonte__detalhe">{linha.detalhe}</span>
              </div>
              {podeEditar ? (
                <div className="fonte__acoes">
                  {linha.tipo === 'conta' ? (
                    <form action={alternarColeta}>
                      <input type="hidden" name="clientId" value={cliente.id} />
                      <input type="hidden" name="accountId" value={linha.id} />
                      <input type="hidden" name="ligar" value={linha.coletaLigada ? 'nao' : 'sim'} />
                      <button className="btn btn--compacto" type="submit">
                        {linha.coletaLigada ? 'Pausar coleta' : 'Retomar coleta'}
                      </button>
                    </form>
                  ) : null}
                  <MenuMais rotulo={`Mais ações de ${linha.nome}`} textoDoGatilho="Mais" compacto>
                    <div className="menu-mais__bloco">
                      {linha.tipo === 'conta' && destinos.length > 0 ? (
                        <form action={moverConta} className="form--inline">
                          <input type="hidden" name="clientId" value={cliente.id} />
                          <input type="hidden" name="accountId" value={linha.id} />
                          <select className="select select--compacto" name="destinoId" defaultValue="" required aria-label={`Mover ${linha.nome} para outro cliente`}>
                            <option value="" disabled>
                              Mover para…
                            </option>
                            {destinos.map((destino) => (
                              <option key={destino.id} value={destino.id}>
                                {destino.name}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn--compacto" type="submit">
                            Mover
                          </button>
                        </form>
                      ) : null}
                      {linha.tipo === 'fonte' && destinosAtivos.length > 0 ? (
                        <form action={moverFonte} className="form--inline">
                          <input type="hidden" name="clientId" value={cliente.id} />
                          <input type="hidden" name="recursoId" value={linha.id} />
                          <select className="select select--compacto" name="destinoId" defaultValue="" required aria-label={`Cliente que passa a ser dono de ${linha.nome}`}>
                            <option value="" disabled>
                              Mover para…
                            </option>
                            {destinosAtivos.map((destino) => (
                              <option key={destino.id} value={destino.id}>
                                {destino.name}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn--compacto" type="submit">
                            Mover
                          </button>
                        </form>
                      ) : null}
                      <form action={linha.tipo === 'conta' ? desvincularContaDeAnuncio : desvincularFonte}>
                        <input type="hidden" name="clientId" value={cliente.id} />
                        <input type="hidden" name={linha.tipo === 'conta' ? 'accountId' : 'recursoId'} value={linha.id} />
                        <button className="btn btn--compacto btn--perigo" type="submit" aria-label={`Desvincular ${linha.nome}`}>
                          Desvincular
                        </button>
                      </form>
                    </div>
                  </MenuMais>
                </div>
              ) : null}
            </li>
          ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
