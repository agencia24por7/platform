import Link from 'next/link';
import { Feedback } from '@/../app/_components/Feedback';
import { Marca } from '@/../app/_components/Marca';
import { Barra } from '@/../app/clientes/[id]/_componentes/Anel';
import { carregarContas, carregarContexto, carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { modules } from '@/composition';
import { CATALOGO, REDES_SOCIAIS } from '@/modules/clients/domain/contexto/catalogo';
import { rotuloDaOpcao } from '@/modules/clients/domain/contexto/valores';
import { ROTULO_DA_PLATAFORMA } from '@/modules/connections/domain/connection';
import { rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { barrasDaSecao, resumirCompletude, saudeDosDados, tempoRelativo } from '@/modules/clients/domain/painel/resumo';
import { frescorPelaColeta } from '@/modules/clients/domain/painel/brain/exemplo';
import { ROTULO_DO_FRESCOR } from '@/modules/clients/domain/painel/brain/tipos';

export const dynamic = 'force-dynamic';

type Acao = { readonly titulo: string; readonly porque: string; readonly href: string; readonly rotulo: string; readonly tom: 'alta' | 'media' };

const ROTULO_DA_OPERACAO: Record<string, string> = { criar: 'preencheu', alterar: 'alterou', status: 'marcou', remover: 'removeu' };

export default async function VisaoGeral({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente, podeEditar } = await carregarPainel(id);
  const escopo = { organizationId: ctx.organization.id, clientId: cliente.id };
  const [contexto, [contas, fontes], revisoes, links] = await Promise.all([
    carregarContexto(escopo.organizationId, escopo.clientId),
    carregarContas(escopo.organizationId, escopo.clientId),
    modules().contexto.listarRevisoes({ ...escopo, limite: 8 }),
    modules().contexto.listarLinks(escopo),
  ]);
  const agora = new Date();
  const saude = saudeDosDados(contas, agora);
  const secoes = contexto?.completude.secoes ?? [];
  const resumo = resumirCompletude(contexto?.completude.geral ?? 0, secoes);
  const linksAtivos = links.ok ? links.value.filter((l) => l.estado === 'ativo') : [];

  const descricao = contexto?.campos['descricao_do_cliente']?.valor;
  const redes = contexto?.listas['redes_sociais'] ?? [];
  const produtos = contexto?.listas['produtos'] ?? [];

  const acoes: Acao[] = [];
  if (contas.length + fontes.length === 0) {
    acoes.push({ titulo: 'Vincular a primeira conta ou fonte', porque: 'Sem conta vinculada o cliente não entra na fila de coleta.', href: `/clientes/${cliente.id}/contas/nova`, rotulo: 'Vincular', tom: 'alta' });
  }
  if (saude.paradas + saude.atrasadas > 0) {
    acoes.push({ titulo: `${saude.paradas + saude.atrasadas} conta(s) com coleta atrasada`, porque: 'O dado mais recente já não reflete o que está no ar.', href: rotaDoCliente(cliente.id, 'dados'), rotulo: 'Ver dados', tom: 'alta' });
  }
  for (const falta of contexto?.proximos.slice(0, 3) ?? []) {
    const secao = CATALOGO.find((s) => s.key === falta.secao);
    acoes.push({
      titulo: falta.motivo === 'sugestao_pendente' ? `Confirmar sugestão: ${falta.rotulo}` : `Preencher “${falta.rotulo}”`,
      porque: `${secao?.letra ?? ''} · ${secao?.titulo ?? falta.secao}${falta.nivel === 'essencial' ? ' — essencial' : ''}${falta.faltamItens > 0 ? ` · faltam ${falta.faltamItens}` : ''}`,
      href: rotaDoCliente(cliente.id, 'contexto', { secao: falta.secao, campo: falta.fieldKey }),
      rotulo: 'Abrir',
      tom: falta.nivel === 'essencial' ? 'alta' : 'media',
    });
  }
  if (podeEditar && linksAtivos.length === 0 && resumo.geral < 60) {
    acoes.push({ titulo: 'Pedir ao cliente para preencher', porque: 'Mande o mapa de contexto por link: ele responde no próprio ritmo.', href: rotaDoCliente(cliente.id, 'acessos', { enviar: 'contexto' }), rotulo: 'Enviar', tom: 'media' });
  }

  return (
    <div className="visao">
      <Feedback message={primeiro(busca['erro'])} tone="error" />
      <Feedback message={primeiro(busca['feito'])} tone="ok" />

      <section className="visao__destaques" aria-label="O essencial sobre o cliente">
        <article className="card destaque destaque--descricao">
          <div className="destaque__topo">
            <h2 className="destaque__titulo">Descrição do cliente</h2>
            <Link className="quiet-link" href={rotaDoCliente(cliente.id, 'contexto', { secao: 'empresa', campo: 'descricao_do_cliente' })}>
              {typeof descricao === 'string' ? 'Editar' : 'Escrever'}
            </Link>
          </div>
          {typeof descricao === 'string' ? (
            <p className="destaque__texto">{descricao}</p>
          ) : (
            <p className="destaque__vazio">O que faz, para quem e por que alguém compra deles e não do concorrente. É a primeira coisa que qualquer pessoa (ou agente) precisa saber.</p>
          )}
        </article>
        <article className="card destaque">
          <div className="destaque__topo">
            <h2 className="destaque__titulo">Redes sociais</h2>
            <Link className="quiet-link" href={rotaDoCliente(cliente.id, 'contexto', { secao: 'presenca_digital', campo: 'redes_sociais' })}>
              + Adicionar
            </Link>
          </div>
          {redes.length > 0 ? (
            <ul className="redes">
              {redes.slice(0, 8).map((rede) => (
                <li key={rede.id} className="rede">
                  <span className="rede__nome">{rotuloDaOpcao(REDES_SOCIAIS, String(rede.dados['rede'] ?? ''))}</span>
                  <span className="rede__perfil">{String(rede.dados['perfil'] ?? '')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="destaque__vazio">Nenhuma rede ainda. Rede + @ já basta para começar.</p>
          )}
        </article>
        <article className="card destaque">
          <div className="destaque__topo">
            <h2 className="destaque__titulo">Catálogo de produtos</h2>
            <Link className="quiet-link" href={rotaDoCliente(cliente.id, 'contexto', { secao: 'produtos', campo: 'produtos' })}>
              + Adicionar
            </Link>
          </div>
          {produtos.length > 0 ? (
            <>
              <p className="destaque__numero">
                {produtos.length} <span>produto(s) ou serviço(s)</span>
              </p>
              <ul className="etiquetas">
                {produtos.slice(0, 6).map((p) => (
                  <li key={p.id} className="etiqueta">{String(p.dados['nome'] ?? 'Sem nome')}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="destaque__vazio">Cadastre um a um ou envie a planilha / feed na seção B.</p>
          )}
        </article>
      </section>

      <div className="visao__grade">
        <section className="card" aria-labelledby="t-completude">
          <div className="card__head">
            <h2 className="card__title" id="t-completude">Completude por seção</h2>
            <span className="card__sub">
              {resumo.essenciaisFeitos}/{resumo.essenciaisTotal} essenciais · {resumo.secoesCompletas} seção(ões) completa(s)
            </span>
          </div>
          <ol className="secoes-resumo">
            {CATALOGO.map((secao) => {
              const c = secoes.find((s) => s.secao === secao.key);
              const b = c ? barrasDaSecao(c) : null;
              return (
                <li key={secao.key}>
                  <Link className="secao-resumo" href={rotaDoCliente(cliente.id, 'contexto', { secao: secao.key })}>
                    <span className="secao-resumo__letra" aria-hidden="true">{secao.letra}</span>
                    <span className="secao-resumo__nome">{secao.titulo}</span>
                    <span className="secao-resumo__barra">
                      <Barra valor={b?.percentual ?? 0} rotulo={`${secao.titulo}`} tom={b?.estado === 'completa' ? 'ok' : 'acento'} />
                    </span>
                    <span className="secao-resumo__pct">{b?.percentual ?? 0}%</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="pilha">
          <section className="card" aria-labelledby="t-acoes">
            <div className="card__head">
              <h2 className="card__title" id="t-acoes">Próximos passos</h2>
            </div>
            {acoes.length === 0 ? (
              <div className="empty">Tudo em dia por aqui.</div>
            ) : (
              <ol className="acoes-lista">
                {acoes.slice(0, 6).map((acao) => (
                  <li key={acao.titulo} className={`acao acao--${acao.tom}`}>
                    <div className="acao__texto">
                      <span className="acao__titulo">{acao.titulo}</span>
                      <span className="acao__porque">{acao.porque}</span>
                    </div>
                    <Link className="btn btn--compacto" href={acao.href}>
                      {acao.rotulo}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="card" aria-labelledby="t-saude">
            <div className="card__head">
              <h2 className="card__title" id="t-saude">Saúde dos dados</h2>
              <Link className="quiet-link" href={rotaDoCliente(cliente.id, 'dados')}>Ver tudo</Link>
            </div>
            <div className="card__body">
              <dl className="placar">
                <div className="placar__item placar__item--fresco"><dt>Em dia</dt><dd>{saude.frescas}</dd></div>
                <div className="placar__item placar__item--atrasado"><dt>Atrasadas</dt><dd>{saude.atrasadas}</dd></div>
                <div className="placar__item placar__item--parado"><dt>Paradas</dt><dd>{saude.paradas + saude.pausadas}</dd></div>
                <div className="placar__item"><dt>Fontes</dt><dd>{fontes.length}</dd></div>
              </dl>
              {contas.length > 0 ? (
                <ul className="mini-contas">
                  {contas.slice(0, 5).map((conta) => {
                    const frescor = conta.syncEnabled ? frescorPelaColeta(conta.lastSyncAt, agora) : 'parado';
                    return (
                      <li key={conta.id} className="mini-conta">
                        <Marca platform={conta.platform} tamanho={20} />
                        <span className="mini-conta__nome">{conta.name}</span>
                        <span className={`frescor frescor--${frescor}`}>
                          <span className="dot" />
                          {conta.syncEnabled ? `${ROTULO_DO_FRESCOR[frescor]} · ${tempoRelativo(conta.lastSyncAt, agora)}` : 'Pausada'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="subtle small">Nenhuma conta de anúncio vinculada.</p>
              )}
              {fontes.length > 0 ? (
                <p className="subtle small">
                  Fontes: {[...new Set(fontes.map((f) => ROTULO_DA_PLATAFORMA[f.platform]))].join(', ')}
                </p>
              ) : null}
            </div>
          </section>

          <section className="card" aria-labelledby="t-atividade">
            <div className="card__head">
              <h2 className="card__title" id="t-atividade">Atividade recente no contexto</h2>
            </div>
            {revisoes.ok && revisoes.value.length > 0 ? (
              <ol className="linha-do-tempo">
                {revisoes.value.map((r) => (
                  <li key={r.id} className="linha-do-tempo__item">
                    <span className={`linha-do-tempo__ponto${r.viaLink ? ' linha-do-tempo__ponto--cliente' : ''}`} aria-hidden="true" />
                    <span>
                      <strong>{r.viaLink ? 'O cliente' : 'A equipe'}</strong> {ROTULO_DA_OPERACAO[r.operacao] ?? r.operacao}{' '}
                      <span className="mono">{r.chave}</span>
                    </span>
                    <time className="subtle xsmall" dateTime={r.em.toISOString()}>{tempoRelativo(r.em, agora)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="empty">Nada ainda. As mudanças no contexto aparecem aqui.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
