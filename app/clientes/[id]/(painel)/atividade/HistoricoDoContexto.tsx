import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { carregarPainel } from '@/../app/clientes/[id]/_dados';
import { modules } from '@/composition';
import { traduzirCatalogo } from '@/modules/clients/domain/contexto/vocabulario';
import { catalogoDaVisao, visaoDoPapel } from '@/modules/clients/domain/contexto/visaoDoCliente';
import { visaoDasRevisoes } from '@/modules/clients/domain/painel/atividade';
import { ancoraDaAtividade, ROTULO_DA_SECAO_DE_ATIVIDADE } from '@/modules/clients/domain/painel/enderecos';

const LIMITE_DE_REVISOES = 60;

export async function HistoricoDoContexto({ clienteId }: { readonly clienteId: string }) {
  const { ctx, cliente } = await carregarPainel(clienteId);
  const resultado = await modules().contexto.listarRevisoes({ organizationId: ctx.organization.id, clientId: cliente.id, papelDeQuemLe: ctx.role, limite: LIMITE_DE_REVISOES, chave: null });
  const catalogo = traduzirCatalogo(catalogoDaVisao(visaoDoPapel(ctx.role)), ctx.organization.type);
  const revisoes = resultado.ok ? visaoDasRevisoes(resultado.value, catalogo, new Date()) : [];
  const ancora = ancoraDaAtividade('contexto');

  return (
    <section className="pilha atividade-secao" aria-labelledby={`${ancora}-titulo`} id={ancora}>
      <CabecalhoDeSecao id={`${ancora}-titulo`} titulo={ROTULO_DA_SECAO_DE_ATIVIDADE.contexto} descricao="O que mudou no mapa de contexto, da mudança mais recente para a mais antiga." />
      {!resultado.ok ? (
        <div className="alert alert--error">Não foi possível carregar o histórico do contexto agora.</div>
      ) : revisoes.length === 0 ? (
        <EstadoVazio titulo="Nenhuma revisão ainda" />
      ) : (
        <ol className="revisoes">
          {revisoes.map((revisao) => (
            <li key={revisao.id} className="revisao">
              <div className="revisao__topo">
                <span className="strong small">
                  {revisao.secao} › {revisao.campo}
                </span>
                <span className="pill">{revisao.origem}</span>
                <span className="subtle xsmall">{revisao.operacao}</span>
                <time className="subtle xsmall" dateTime={revisao.emIso} title={revisao.emIso}>
                  {revisao.quando}
                </time>
              </div>
              {revisao.diferencas.length > 0 ? (
                <ul className="revisao__difs">
                  {revisao.diferencas.map((d) => (
                    <li key={d.chave}>
                      <span className="mono">{d.chave}</span>: <del>{d.antes}</del> → <ins>{d.depois}</ins>
                    </li>
                  ))}
                  {revisao.diferencasOcultas > 0 ? <li className="subtle xsmall">e mais {revisao.diferencasOcultas}</li> : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
    )}
  </section>
  );
}
