import Link from 'next/link';
import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { carregarPainel } from '@/../app/clientes/[id]/_dados';
import { CartaoDeRegra } from '@/../app/clientes/[id]/(painel)/regras/CartaoDeRegra';
import { carregarDefinicoes, definicaoDaDecisao, nomesDaEquipe } from '@/../app/clientes/[id]/(painel)/regras/dados';
import { FiltrosDaLinha } from '@/../app/clientes/[id]/(painel)/regras/FiltrosDaLinha';
import { modules } from '@/composition';
import { ancoraDaAtividade, rotaDaAtividade, ROTULO_DA_SECAO_DE_ATIVIDADE } from '@/modules/clients/domain/painel/enderecos';
import { buscaDaLinha, lerFiltrosDaLinha, ROTULO_DA_CATEGORIA, ROTULO_DO_STATUS } from '@/modules/clients/domain/painel/regras';
import { CATEGORIAS, ORIGENS, STATUS } from '@/modules/clients/domain/regras/index';
import { vocabularioDe } from '@/modules/organizations/domain/vocabulario';

const ITENS_POR_PAGINA = 20;

export async function LinhaDoTempoDeRegras({ clienteId, busca }: { readonly clienteId: string; readonly busca: Readonly<Record<string, string | undefined>> }) {
  const { ctx, cliente } = await carregarPainel(clienteId);
  const escopo = { organizationId: ctx.organization.id, clientId: cliente.id };
  const vocabulario = vocabularioDe(ctx.organization.type);
  const filtros = lerFiltrosDaLinha(busca);
  const semCursor = { categoria: filtros.categoria, origem: filtros.origem, status: filtros.status };
  const ancora = ancoraDaAtividade('regras');
  const [pagina, definicoes] = await Promise.all([modules().regras.linhaDoTempo(escopo, { ...filtros, limite: ITENS_POR_PAGINA }), carregarDefinicoes(cliente.id)]);
  const nomes = pagina.ok ? await nomesDaEquipe(cliente.id, pagina.value.itens) : new Map<string, string>();

  return (
    <section className="pilha atividade-secao" aria-labelledby={`${ancora}-titulo`} id={ancora}>
      <CabecalhoDeSecao id={`${ancora}-titulo`} titulo={ROTULO_DA_SECAO_DE_ATIVIDADE.regras} descricao="Cada limite, regra e decisão registrada, da mais recente para a mais antiga." />
      <FiltrosDaLinha action={rotaDaAtividade(cliente.id, 'regras')} rotulo="Filtrar a linha do tempo">
        <label className="field">
          <span className="field__label">Categoria</span>
          <select className="select" name="categoria" defaultValue={filtros.categoria ?? ''}>
            <option value="">Todas</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {ROTULO_DA_CATEGORIA[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Origem</span>
          <select className="select" name="origem" defaultValue={filtros.origem ?? ''}>
            <option value="">Todas</option>
            {ORIGENS.map((o) => (
              <option key={o} value={o}>
                {o === 'cliente' ? vocabulario.origemCliente : o === 'agencia' ? vocabulario.origemEquipe : 'Agente'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Status</span>
          <select className="select" name="status" defaultValue={filtros.status ?? ''}>
            <option value="">Todos</option>
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {ROTULO_DO_STATUS[s]}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <noscript>
            <button className="btn btn--primary" type="submit">
              Filtrar
            </button>
          </noscript>
          <Link className="btn" href={rotaDaAtividade(cliente.id, 'regras')}>
            Limpar
          </Link>
        </div>
      </FiltrosDaLinha>
      {!pagina.ok ? (
        <div className="alert alert--error">{pagina.error.message}</div>
      ) : pagina.value.itens.length === 0 ? (
        <EstadoVazio titulo="Nenhum registro" texto="Nenhum registro com estes filtros." />
      ) : (
        <ol className="regras-lista regras-lista--linha" aria-label="Decisões, da mais recente para a mais antiga">
          {pagina.value.itens.map((d) => (
            <li key={d.id}>
              <CartaoDeRegra clienteId={cliente.id} decisao={d} definicao={definicaoDaDecisao(definicoes, d)} nomes={nomes} vocabulario={vocabulario} papel={ctx.role} modo="linha" nivelDoTitulo="h3" />
            </li>
          ))}
        </ol>
      )}
      {pagina.ok ? (
        <nav className="regras-paginas" aria-label="Paginação da linha do tempo">
          {filtros.cursor !== null ? (
            <Link className="btn" href={rotaDaAtividade(cliente.id, 'regras', buscaDaLinha(semCursor, null))}>
              Voltar ao início
            </Link>
          ) : null}
          {pagina.value.proximoCursor !== null ? (
            <Link className="btn" rel="next" href={rotaDaAtividade(cliente.id, 'regras', buscaDaLinha(semCursor, pagina.value.proximoCursor))}>
              Ver mais antigas
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
