import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { arquivarLandingPageAcao, criarLandingPageAcao, gravarWhatsappAcao } from '@/../app/clientes/[id]/(painel)/contexto/destino/acoes';
import type { VisaoDoDestino } from '@/modules/clients/domain/painel/visaoDoDestino';

export function Destino({ clienteId, visao }: { readonly clienteId: string; readonly visao: VisaoDoDestino | null }) {
  if (!visao) {
    return (
      <div className="alert alert--error" role="alert">
        Não foi possível carregar o destino deste cliente. Tente de novo.
      </div>
    );
  }
  const campoCliente = <input type="hidden" name="clienteId" value={clienteId} />;

  return (
    <div className="pilha">
      <section className="destino-bloco" aria-labelledby="destino-whatsapp">
        <h3 className="nivel__titulo" id="destino-whatsapp">
          WhatsApp
        </h3>
        <div className="pilha">
          <p className="field__hint">{visao.whatsapp.situacao}</p>
          {visao.podeEditar ? (
            <form className="destino-form" action={gravarWhatsappAcao}>
              {campoCliente}
              <div className="field">
                <label className="field__label" htmlFor="destino-whatsapp-valor">
                  Número com DDD
                </label>
                <input id="destino-whatsapp-valor" className="input" name="whatsapp" defaultValue={visao.whatsapp.valor ?? ''} inputMode="tel" autoComplete="off" placeholder="+55 11 99999-8888" />
              </div>
              <BotaoDeEnvio className="btn" pendente="Salvando…">
                Salvar WhatsApp
              </BotaoDeEnvio>
            </form>
          ) : (
            <p className="bloco__texto">{visao.whatsapp.valor ?? 'Não cadastrado'}</p>
          )}
        </div>
      </section>

      <section className="destino-bloco" aria-labelledby="destino-paginas">
        <h3 className="nivel__titulo" id="destino-paginas">
          Landing pages
        </h3>
        <div className="pilha">
          {visao.paginas.length === 0 ? (
            <EstadoVazio titulo="Nenhuma landing page" texto={visao.semPaginas} />
          ) : (
            <ul className="destino-lista">
              {visao.paginas.map((pagina) => (
                <li key={pagina.id} className="destino-lista__item">
                  <span className="destino-lista__textos">
                    <strong>{pagina.rotulo}</strong>
                    <span className="subtle">{pagina.url}</span>
                  </span>
                  {visao.podeEditar ? (
                    <ConfirmarAcao
                      gatilho="Arquivar"
                      rotuloDoGatilho={`Arquivar ${pagina.rotulo}`}
                      titulo="Arquivar a landing page?"
                      descricao="Ela deixa de aparecer na escolha de novos planos. Planos que já a usam continuam como estão."
                      confirmar="Arquivar"
                      pendente="Arquivando…"
                      action={arquivarLandingPageAcao}
                    >
                      {campoCliente}
                      <input type="hidden" name="landingPageId" value={pagina.id} />
                    </ConfirmarAcao>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {visao.podeEditar ? (
            <form className="destino-form" action={criarLandingPageAcao}>
              {campoCliente}
              <div className="field">
                <label className="field__label" htmlFor="destino-pagina-rotulo">
                  Nome
                </label>
                <input id="destino-pagina-rotulo" className="input" name="rotulo" maxLength={120} autoComplete="off" />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="destino-pagina-url">
                  Endereço (https)
                </label>
                <input id="destino-pagina-url" className="input" name="url" type="url" inputMode="url" autoComplete="off" placeholder="https://" />
              </div>
              <BotaoDeEnvio className="btn" pendente="Cadastrando…">
                Cadastrar landing page
              </BotaoDeEnvio>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}
