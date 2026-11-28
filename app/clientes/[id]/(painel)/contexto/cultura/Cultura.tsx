import { carregarPainel } from '@/../app/clientes/[id]/_dados';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { arquivarSinalDeCulturaAcao, criarSinalDeCulturaAcao } from '@/../app/clientes/[id]/(painel)/contexto/cultura/acoes';
import { modules } from '@/composition';
import { hojeEmSaoPaulo } from '@/modules/brain/domain/tempo';
import { visaoDeCultura } from '@/modules/brain/interface/visaoDeCultura';

export async function Cultura({ clienteId }: { readonly clienteId: string }) {
  const { ctx, cliente, podeEditar } = await carregarPainel(clienteId);
  const sinais = await modules().cultura.listar({ organizationId: ctx.organization.id, clientId: cliente.id });
  if (!sinais.ok) {
    return (
      <div className="alert alert--error" role="alert">
        Não foi possível carregar os sinais de cultura deste cliente. Tente de novo.
      </div>
    );
  }
  const visao = visaoDeCultura({ sinais: sinais.value, podeEditar, hoje: hojeEmSaoPaulo(new Date()) });
  const form = visao.formulario;
  const campoCliente = <input type="hidden" name="clienteId" value={clienteId} />;

  return (
    <details className="card brain-recolhivel" id="sinais-de-cultura">
      <summary className="card__head">
        <h2 className="card__title" id="t-sinais-de-cultura">Sinais de cultura</h2>
        <span className="card__sub">{visao.contagem}</span>
      </summary>
      <div className="pilha">
      <p className="subtle small">Tendências, memes, conversas, movimentos de comunidade e referências criativas que o planejador usa. Cada sinal vale por no máximo 90 dias.</p>

      {visao.aviso ? (
        <div className="alert" role="status">
          {visao.aviso}
        </div>
      ) : null}

      <section className="card" aria-labelledby="cultura-lista">
        <div className="card__head">
          <h3 className="card__title" id="cultura-lista">
            Sinais cadastrados
          </h3>
        </div>
        <div className="card__body">
          {visao.sinais.length === 0 ? (
            <EstadoVazio titulo="Nenhum sinal" texto={visao.semSinais} />
          ) : (
            <ul className="destino-lista">
              {visao.sinais.map((sinal) => (
                <li key={sinal.id} className="destino-lista__item">
                  <span className="destino-lista__textos">
                    <strong>{sinal.titulo}</strong>
                    <span>{sinal.resumo}</span>
                    <span className="subtle">
                      {sinal.tipo}
                      {sinal.plataforma ? ` · ${sinal.plataforma}` : ''} · {sinal.nota} · {sinal.origem}
                    </span>
                    <span className="subtle">{sinal.janela}</span>
                    <span className="subtle">
                      Fonte: {sinal.fonteNome} ({sinal.fonteUrl})
                    </span>
                    <span className="subtle">
                      <span aria-hidden="true">{sinal.situacao.icone}</span> {sinal.situacao.rotulo}
                    </span>
                  </span>
                  {visao.podeEditar ? (
                    <ConfirmarAcao
                      gatilho="Arquivar"
                      rotuloDoGatilho={`Arquivar o sinal ${sinal.titulo}`}
                      titulo="Arquivar o sinal?"
                      descricao="Ele sai do Brain e do planejador. Não dá para desfazer pela tela."
                      confirmar="Arquivar"
                      pendente="Arquivando…"
                      action={arquivarSinalDeCulturaAcao}
                    >
                      {campoCliente}
                      <input type="hidden" name="sinalId" value={sinal.id} />
                    </ConfirmarAcao>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {visao.podeEditar ? (
        <section className="card" aria-labelledby="cultura-novo">
          <div className="card__head">
            <h3 className="card__title" id="cultura-novo">
              Novo sinal
            </h3>
          </div>
          <div className="card__body">
            <p className="field__hint">{form.lembrete}</p>
            <form className="destino-form" action={criarSinalDeCulturaAcao}>
              {campoCliente}
              <div className="field">
                <label className="field__label" htmlFor="cultura-tipo">
                  Tipo
                </label>
                <select id="cultura-tipo" className="select" name="tipo" required defaultValue="">
                  <option value="" disabled>
                    Escolha o tipo
                  </option>
                  {form.tipos.map((tipo) => (
                    <option key={tipo.valor} value={tipo.valor}>
                      {tipo.rotulo}: {tipo.ajuda}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cultura-titulo">
                  Título
                </label>
                <input id="cultura-titulo" className="input" name="titulo" required maxLength={form.limites.titulo} autoComplete="off" />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cultura-resumo">
                  Resumo do que está acontecendo
                </label>
                <textarea id="cultura-resumo" className="input textarea" name="resumo" required rows={4} maxLength={form.limites.resumo} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cultura-fonte-nome">
                  Nome da fonte
                </label>
                <input id="cultura-fonte-nome" className="input" name="fonteNome" required maxLength={form.limites.fonteNome} autoComplete="off" />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cultura-fonte-url">
                  Endereço da fonte (https)
                </label>
                <input id="cultura-fonte-url" className="input" name="fonteUrl" type="url" inputMode="url" required maxLength={form.limites.fonteUrl} autoComplete="off" placeholder="https://" />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cultura-plataforma">
                  Plataforma (opcional)
                </label>
                <select id="cultura-plataforma" className="select" name="plataforma" defaultValue="">
                  <option value="">Sem plataforma</option>
                  {form.plataformas.map((plataforma) => (
                    <option key={plataforma.valor} value={plataforma.valor}>
                      {plataforma.rotulo}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cultura-observado">
                  Observado em
                </label>
                <input id="cultura-observado" className="input" name="observadoEm" type="date" required defaultValue={form.observadoEmPadrao} max={form.observadoEmPadrao} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cultura-valido">
                  Vale até (no máximo 90 dias depois da observação)
                </label>
                <input id="cultura-valido" className="input" name="validoAte" type="date" required defaultValue={form.validoAtePadrao} max={form.validoAteMaximo} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cultura-nota">
                  Nota da evidência
                </label>
                <select id="cultura-nota" className="select" name="nota" required defaultValue="">
                  <option value="" disabled>
                    Escolha a nota
                  </option>
                  {form.notas.map((nota) => (
                    <option key={nota.valor} value={nota.valor}>
                      {nota.rotulo}
                    </option>
                  ))}
                </select>
              </div>
              <BotaoDeEnvio className="btn" pendente="Cadastrando…">
                Cadastrar sinal
              </BotaoDeEnvio>
            </form>
          </div>
        </section>
      ) : null}
      </div>
    </details>
  );
}
