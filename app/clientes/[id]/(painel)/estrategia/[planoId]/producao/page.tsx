import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { AvisoEfemero } from '@/../app/clientes/[id]/_componentes/AvisoEfemero';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { AtualizacaoPeriodica } from '@/../app/clientes/[id]/(painel)/estrategia/AtualizacaoPeriodica';
import { gerarPlanoDeProducaoAcao } from '@/../app/clientes/[id]/(painel)/estrategia/[planoId]/producao/acoes';
import { modules } from '@/composition';
import { idValido, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { podeVerAEstrategia } from '@/modules/strategy/domain/papeis';
import { ROTULO_DO_DOWNLOAD, visaoDoPlanoDeProducao, type CampanhaNaTela, type EntregavelNaTela, type EstadoNaTela } from '@/modules/strategy/interface/planoDeProducao';

export const dynamic = 'force-dynamic';

const CLASSE_DO_TOM = { info: 'alert--info', ok: 'alert--ok', warn: 'alert--warn', danger: 'alert--error' } as const;

function Estado({ estado }: { readonly estado: EstadoNaTela }) {
  return (
    <div className={`alert ${CLASSE_DO_TOM[estado.tom]}`} role={estado.tom === 'danger' ? 'alert' : 'status'}>
      <Icone nome={estado.icone} />
      <div className="estrategia-aviso">
        <p className="estrategia-aviso__titulo">{estado.titulo}</p>
        <p>{estado.texto}</p>
      </div>
    </div>
  );
}

function Itens({ itens }: { readonly itens: readonly string[] }) {
  if (itens.length === 0) return <p className="field__hint">Sem registro.</p>;
  return (
    <ul>
      {itens.map((item, indice) => (
        <li key={indice}>{item}</li>
      ))}
    </ul>
  );
}

function Entregavel({ entregavel }: { readonly entregavel: EntregavelNaTela }) {
  return (
    <article className="pilha" aria-label={entregavel.nome}>
      <h4 className="card__title">
        {entregavel.nome} <span className="field__hint">({entregavel.tipo})</span>
      </h4>
      <ul>
        <li>{entregavel.especificacao}</li>
        {entregavel.proporcao ? <li>Proporção: {entregavel.proporcao}</li> : null}
        {entregavel.duracao ? <li>Duração: {entregavel.duracao}</li> : null}
        <li>Justificativa: {entregavel.justificativa}</li>
        {entregavel.fontes.length > 0 ? <li>Fontes: {entregavel.fontes.join('; ')}</li> : null}
      </ul>
      {entregavel.textos.length > 0 ? (
        <details>
          <summary>Textos ({entregavel.textos.length})</summary>
          <Itens itens={entregavel.textos.map((peca) => `${peca.campo ?? 'texto'}: ${peca.texto} (${peca.tamanho})`)} />
        </details>
      ) : null}
      {entregavel.roteiro.length > 0 ? (
        <details>
          <summary>Roteiro ({entregavel.roteiro.length} cenas)</summary>
          <Itens itens={entregavel.roteiro} />
        </details>
      ) : null}
      <details>
        <summary>Prompts ({entregavel.prompts.length})</summary>
        <ul>
          {entregavel.prompts.map((prompt, indice) => (
            <li key={indice}>
              <strong>{prompt.tipo}:</strong> {prompt.prompt}
            </li>
          ))}
        </ul>
      </details>
      {entregavel.referencias.length > 0 ? (
        <details>
          <summary>Referências do Brain ({entregavel.referencias.length})</summary>
          <Itens itens={entregavel.referencias} />
        </details>
      ) : null}
    </article>
  );
}

function Campanha({ campanha }: { readonly campanha: CampanhaNaTela }) {
  const idDoTitulo = `producao-campanha-${campanha.id}`;
  return (
    <section className="card estrategia-bloco" aria-labelledby={idDoTitulo}>
      <div className="card__head">
        <h3 className="card__title" id={idDoTitulo}>
          {campanha.titulo}
        </h3>
        {campanha.fatos.length > 0 ? <p className="field__hint">{campanha.fatos.join(' · ')}</p> : null}
      </div>
      <div className="card__body pilha">
        <p>
          <strong>Conceito:</strong> {campanha.conceito}
        </p>
        {campanha.entregaveis.map((entregavel) => (
          <Entregavel key={entregavel.id} entregavel={entregavel} />
        ))}
        <h4 className="card__title">Ferramentas</h4>
        <Itens itens={campanha.ferramentas} />
        <h4 className="card__title">Custos</h4>
        <Itens itens={campanha.custos} />
        <h4 className="card__title">Workflow</h4>
        <Itens itens={campanha.workflow} />
        <h4 className="card__title">Lacunas</h4>
        <Itens itens={campanha.lacunas} />
      </div>
    </section>
  );
}

export default async function PaginaDoPlanoDeProducao({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string; planoId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id, planoId }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente } = await carregarPainel(id);
  if (!podeVerAEstrategia(ctx.role)) redirect(rotaDoCliente(cliente.id, 'conexoes'));
  if (!idValido(planoId)) notFound();

  const comando = { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role };
  const painel = await modules().strategy.producao.painel(comando, { clienteId: cliente.id, planoId });
  if (!painel.ok) notFound();

  const visao = visaoDoPlanoDeProducao({
    clienteId: cliente.id,
    planoId,
    papel: ctx.role,
    temVersaoAutorizada: painel.value.vigente !== null && painel.value.vigente.redigidaEm === null,
    planoDeMarketing: painel.value.planoDeMarketing,
    geracoes: painel.value.geracoes,
  });

  return (
    <div className="pilha estrategia">
      <AvisoEfemero erro={primeiro(busca['erro'])} feito={primeiro(busca['feito'])} />
      <AtualizacaoPeriodica ativa={visao.atualizarAutomaticamente} />
      <Link className="estrategia-voltar" href={visao.voltar.href}>
        <span aria-hidden="true">←</span> {visao.voltar.rotulo}
      </Link>
      <header className="estrategia-cabecalho">
        <h2 className="secao-topo__titulo">{visao.titulo}</h2>
        {visao.atual ? <p className="estrategia-cabecalho__fatos">Janela do calendário: {visao.atual.janela}</p> : null}
      </header>
      <Estado estado={visao.estado} />
      <div className="estrategia-acao">
        {visao.gerar.habilitado ? (
          <form action={gerarPlanoDeProducaoAcao}>
            <input type="hidden" name="clienteId" value={cliente.id} />
            <input type="hidden" name="planoId" value={planoId} />
            <BotaoDeEnvio className="btn btn--primary" pendente="Pedindo…">
              {visao.gerar.rotulo}
            </BotaoDeEnvio>
          </form>
        ) : (
          <>
            <button type="button" className="btn" disabled aria-describedby="motivo-gerar-producao">
              {visao.gerar.rotulo}
            </button>
            {visao.gerar.motivo ? (
              <p className="field__hint" id="motivo-gerar-producao">
                {visao.gerar.motivo}
              </p>
            ) : null}
          </>
        )}
        {visao.atual?.geracao.download ? (
          <a className="btn" href={visao.atual.geracao.download.href} download={visao.atual.geracao.download.nomeDoArquivo}>
            {ROTULO_DO_DOWNLOAD}
          </a>
        ) : null}
      </div>
      {visao.atual ? visao.atual.campanhas.map((campanha) => <Campanha key={campanha.id} campanha={campanha} />) : null}
      {visao.historico.length > 0 ? (
        <section className="card" aria-labelledby="titulo-historico-da-producao">
          <div className="card__head">
            <h3 className="card__title" id="titulo-historico-da-producao">
              Versões do plano de produção
            </h3>
          </div>
          <div className="card__body">
            <ul>
              {visao.historico.map((geracao) => (
                <li key={geracao.id}>
                  <Icone nome={geracao.estado.icone} tamanho={14} /> <strong>{geracao.rotulo}</strong>, <time>{geracao.quando}</time>: {geracao.estado.titulo}.{' '}
                  {geracao.download ? (
                    <a href={geracao.download.href} download={geracao.download.nomeDoArquivo}>
                      {ROTULO_DO_DOWNLOAD}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
