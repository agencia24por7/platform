import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { caminhoLegivel, type VisaoDoPlano } from '@/modules/strategy/interface/visaoDoPlano';

export function SecaoComite({ visao }: { readonly visao: VisaoDoPlano }) {
  if (visao.pareceres.length === 0) {
    return <EstadoVazio titulo="O Comitê ainda não opinou" texto="Os pareceres aparecem aqui depois que o agente redige o plano." />;
  }
  return (
    <div className="pilha">
      {visao.resumoDoComite ? <p className="subtle">{visao.resumoDoComite}</p> : null}
      <div className="estrategia-grade">
        {visao.pareceres.map((parecer) => (
          <article key={parecer.persona} className="card" aria-labelledby={`parecer-${parecer.persona}`}>
            <div className="card__head estrategia-parecer__topo">
              <div>
                <h3 className="card__title" id={`parecer-${parecer.persona}`}>
                  {parecer.nome}
                </h3>
                {parecer.foco ? <p className="card__sub">{parecer.foco}</p> : null}
              </div>
              <span className={`pill ${parecer.classe}`}>
                <Icone nome={parecer.icone} tamanho={14} />
                {parecer.rotuloDoVeredito}
              </span>
            </div>
            <div className="card__body">
              <p>{parecer.motivo}</p>
              {parecer.pontos.length > 0 ? (
                <ul className="estrategia-pontos" aria-label={`Pontos de ${parecer.nome}`}>
                  {parecer.pontos.map((ponto) => (
                    <li key={ponto.id} className="estrategia-ponto">
                      <p className="estrategia-ponto__trecho">
                        Trecho: <code>{caminhoLegivel(ponto.trecho)}</code>
                      </p>
                      <p>
                        <strong>Problema:</strong> {ponto.problema}
                      </p>
                      <p>
                        <strong>Ajuste pedido:</strong> {ponto.ajustePedido}
                      </p>
                      {ponto.resposta ? (
                        <p className="estrategia-ponto__resposta">
                          <span className={`pill ${ponto.resposta.decisao === 'acatado' ? 'pill--ok' : 'pill--warn'}`}>
                            <Icone nome={ponto.resposta.decisao === 'acatado' ? 'ok' : 'atencao'} tamanho={14} />
                            {ponto.resposta.rotulo}
                          </span>{' '}
                          {ponto.resposta.motivo}
                        </p>
                      ) : (
                        <p className="subtle xsmall">Sem resposta do ajuste ainda.</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function SecaoGates({ visao }: { readonly visao: VisaoDoPlano }) {
  const gates = visao.gates;
  if (!gates) return <EstadoVazio titulo="Os Gates ainda não rodaram" texto="O resultado aparece aqui depois do Comitê e do ajuste." />;
  return (
    <div className="pilha">
      <div className="row">
        <span className={`pill ${gates.classe}`}>
          <Icone nome={gates.icone} tamanho={14} />
          {gates.rotuloDoResultado}
        </span>
        <span className="subtle xsmall">Rodaram em {gates.emTexto}</span>
      </div>
      <ul className="estrategia-checagens" aria-label="Checagens dos Gates">
        {gates.checagens.map((checagem) => (
          <li key={checagem.chave} className="card estrategia-checagem">
            <div className="card__body">
              <div className="estrategia-checagem__topo">
                <p className="card__title">{checagem.rotulo}</p>
                <span className={`pill ${checagem.classe}`}>
                  <Icone nome={checagem.icone} tamanho={14} />
                  {checagem.rotuloDoResultado}
                </span>
              </div>
              {checagem.motivo ? <p>{checagem.motivo}</p> : null}
              {checagem.onde.length > 0 ? (
                <p className="subtle xsmall">
                  Onde: <code>{checagem.onde.map(caminhoLegivel).join(', ')}</code>
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {gates.problemasDoModelo.length > 0 ? (
        <section className="card" aria-labelledby="problemas-do-modelo">
          <div className="card__head">
            <h3 className="card__title" id="problemas-do-modelo">
              Problemas apontados pela checagem de coerência
            </h3>
          </div>
          <ul className="card__body estrategia-pontos">
            {gates.problemasDoModelo.map((problema, indice) => (
              <li key={indice} className="estrategia-ponto">
                <p className="estrategia-ponto__trecho">
                  Trecho: <code>{caminhoLegivel(problema.trecho)}</code>
                </p>
                <p>{problema.problema}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function SecaoHistorico({ visao }: { readonly visao: VisaoDoPlano }) {
  if (visao.versoes.length === 0) return <EstadoVazio titulo="Sem histórico ainda" texto="As versões e os eventos aparecem aqui depois do primeiro plano." />;
  return (
    <div className="pilha">
      <section aria-labelledby="historico-versoes" className="pilha">
        <h3 className="regras-grupo__titulo" id="historico-versoes">
          Versões <span className="contador">{visao.versoes.length}</span>
        </h3>
        <ol className="regras-lista" aria-label="Versões do plano, da mais recente para a mais antiga">
          {visao.versoes.map((versao) => (
            <li key={versao.id} className="card estrategia-versao">
              <div className="card__body estrategia-cabecalho__corpo">
                <span className="regra__numero">Versão {versao.numero}</span>
                <span className={`pill ${versao.classe}`}>
                  <Icone nome={versao.icone} tamanho={14} />
                  {versao.rotuloDoStatus}
                </span>
                <span className="regra__origem">
                  <Icone nome={versao.autor.tipo === 'agente' ? 'agente' : 'pessoa'} tamanho={14} />
                  {versao.autor.rotulo}
                </span>
                <time dateTime={versao.em.toISOString()}>{versao.emTexto}</time>
                {versao.exibida ? <span className="subtle xsmall">mostrada na seção Plano</span> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="historico-eventos" className="pilha">
        <h3 className="regras-grupo__titulo" id="historico-eventos">
          Eventos <span className="contador">{visao.eventos.length}</span>
        </h3>
        {visao.eventos.length === 0 ? (
          <p className="subtle">Nenhum evento registrado.</p>
        ) : (
          <ol className="regras-eventos" aria-label="Eventos em ordem cronológica">
            {visao.eventos.map((evento) => (
              <li key={evento.id}>
                <time dateTime={evento.em.toISOString()}>{evento.emTexto}</time> · {evento.rotulo}
                {evento.detalhe ? ` (${evento.detalhe})` : ''}
                {evento.versao ? ` · versão ${evento.versao}` : ''} · {evento.quem.rotulo}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
