'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CampoAutosalvo, type EstadoDoSalvar, type ResultadoDoSalvar } from '@/../app/_components/contexto/CampoAutosalvo';
import { EnvioDeArquivo, type ArquivoEnviado } from '@/../app/_components/contexto/EnvioDeArquivo';
import { ListaEditavel, type ItemDaLista, type RespostaDaLista } from '@/../app/_components/contexto/ListaEditavel';
import { Barra } from '@/../app/clientes/[id]/_componentes/Anel';
import {
  adicionarItemAcao,
  alterarItemAcao,
  compartilharSecaoAcao,
  confirmarSugestaoAcao,
  listarRevisoesAcao,
  marcarAcao,
  recarregarContextoAcao,
  removerArquivoAcao,
  removerItemAcao,
  reordenarAcao,
  salvarCampoAcao,
  type DadosDoEditor,
  type Resposta,
} from '@/../app/clientes/[id]/(painel)/contexto/acoes';
import type { RevisaoDeContexto } from '@/modules/clients/application/contextoService';
import {
  EPISTEMICOS,
  ROTULO_EPISTEMICO,
  ROTULO_FONTE,
  type Campo,
  type CampoSimples,
  type Epistemico,
  type Secao,
} from '@/modules/clients/domain/contexto/catalogo';
import { calcularCompletude } from '@/modules/clients/domain/contexto/completude';
import type { ArquivoDeContexto, EntradaDeCampo, ItemDeLista, Marcacao } from '@/modules/clients/domain/contexto/tipos';
import type { OrganizationType } from '@/modules/organizations/domain/organization';
import { noVocabularioDe, vocabularioDe, type Vocabulario } from '@/modules/organizations/domain/vocabulario';
import { campoEhHerdado } from '@/modules/clients/domain/contexto/heranca';
import { traduzirCatalogo } from '@/modules/clients/domain/contexto/vocabulario';
import { catalogoDaVisao, type VisaoDoContexto } from '@/modules/clients/domain/contexto/visaoDoCliente';
import { rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { barrasDaSecao } from '@/modules/clients/domain/painel/resumo';

type Props = {
  readonly tipo: OrganizationType;
  readonly clienteId: string;
  readonly dados: DadosDoEditor;
  readonly visao: VisaoDoContexto;
  readonly podeEditar: boolean;
  readonly secaoInicial: string | null;
  readonly campoInicial: string | null;
};

const DESTAQUES = [
  { secao: 'empresa', campo: 'descricao_do_cliente', rotulo: '' },
  { secao: 'presenca_digital', campo: 'redes_sociais', rotulo: 'Redes sociais' },
  { secao: 'produtos', campo: 'produtos', rotulo: 'Catálogo de produtos' },
] as const;

function paraResultado(r: Resposta<EntradaDeCampo | null>): ResultadoDoSalvar {
  if (r.ok) return { ok: true, versao: r.valor?.versao ?? 0 };
  return { ok: false, erro: r.erro, conflito: r.codigo === 'conflict', versaoAtual: r.versaoAtual };
}

function paraLista<T>(r: Resposta<T>): RespostaDaLista<T> {
  return r.ok ? r : { ok: false, erro: r.erro, campos: r.campos };
}

function itemDaUi(item: ItemDeLista): ItemDaLista {
  return { id: item.id, dados: item.dados, versao: item.versao, removivel: true, editavel: true };
}

function IndicadorDoCampo({
  vocabulario,
  marcacao,
  interno,
  herdado,
  podeEditar,
  aoMarcar,
  aoConfirmar,
}: {
  readonly vocabulario: Vocabulario;
  readonly marcacao: Marcacao | null;
  readonly interno: boolean;
  readonly herdado: boolean;
  readonly podeEditar: boolean;
  readonly aoMarcar: (epistemico: Epistemico) => void;
  readonly aoConfirmar: () => void;
}) {
  const notas: string[] = [];
  if (interno) notas.push(vocabulario.seloInterno);
  if (herdado) notas.push('Do cadastro');
  if (marcacao?.compartilhavel) notas.push(vocabulario.seloDoCompartilhado);
  if (!marcacao && notas.length === 0) return null;

  const sugerido = marcacao?.revisao === 'sugerido';
  const dica = [
    herdado ? 'Vem do cadastro. Ao editar aqui, o valor passa a ser deste contexto.' : null,
    marcacao ? `Fonte: ${ROTULO_FONTE[marcacao.fonte]}.` : null,
    marcacao?.compartilhavel ? vocabulario.dicaDoSelo : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={`selo selo--unico${marcacao ? ` selo--${marcacao.epistemico}` : ''}${sugerido ? ' selo--sugerido' : ''}`} title={dica || undefined}>
      {sugerido && marcacao ? <span>sugerido por {ROTULO_FONTE[marcacao.fonte]}</span> : null}
      {marcacao && podeEditar ? (
        <select className="selo__escolha" value={marcacao.epistemico} aria-label="Natureza da informação" onChange={(e) => aoMarcar(e.target.value as Epistemico)}>
          {EPISTEMICOS.map((ep) => (
            <option key={ep} value={ep}>{ROTULO_EPISTEMICO[ep]}</option>
          ))}
        </select>
      ) : marcacao ? (
        <span>{ROTULO_EPISTEMICO[marcacao.epistemico]}</span>
      ) : null}
      {notas.length > 0 ? <span className="selo__notas">{notas.join(' · ')}</span> : null}
      {sugerido && podeEditar ? (
        <button type="button" className="selo__acao" onClick={aoConfirmar}>
          Confirmar
        </button>
      ) : null}
    </span>
  );
}

export function EditorDeContexto({ tipo, clienteId, dados, visao, podeEditar, secaoInicial, campoInicial }: Props) {
  const vocabulario = vocabularioDe(tipo);
  const catalogo = useMemo(() => traduzirCatalogo(catalogoDaVisao(visao), tipo), [visao, tipo]);
  const [entradas, setEntradas] = useState<Record<string, EntradaDeCampo>>({ ...dados.campos });
  const [listas, setListas] = useState<Record<string, readonly ItemDeLista[]>>({ ...dados.listas });
  const [arquivos, setArquivos] = useState<readonly ArquivoDeContexto[]>(dados.arquivos);
  const [ativa, setAtiva] = useState<string>(catalogo.some((s) => s.key === secaoInicial) ? secaoInicial! : 'empresa');
  const [realce, setRealce] = useState<string | null>(campoInicial);
  const [estados, setEstados] = useState<Record<string, EstadoDoSalvar>>({});
  const [ultimoSalvo, setUltimoSalvo] = useState<Date | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [revisoes, setRevisoes] = useState<readonly RevisaoDeContexto[] | null>(null);
  const [geracao, setGeracao] = useState(0);
  const historico = useRef<HTMLDialogElement>(null);
  const topoDaSecao = useRef<HTMLHeadingElement>(null);

  const completude = useMemo(
    () =>
      calcularCompletude({
        campos: Object.values(entradas),
        itens: Object.values(listas).flat(),
        arquivos,
      }),
    [entradas, listas, arquivos],
  );

  const secao = catalogo.find((s) => s.key === ativa) ?? catalogo[0]!;
  const indice = catalogo.indexOf(secao);

  const aoEstado = useCallback((chave: string, estado: EstadoDoSalvar) => {
    setEstados((atual) => (atual[chave] === estado ? atual : { ...atual, [chave]: estado }));
    if (estado === 'salvo') setUltimoSalvo(new Date());
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('secao', ativa);
    if (realce) url.searchParams.set('campo', realce);
    else url.searchParams.delete('campo');
    window.history.replaceState(null, '', url);
  }, [ativa, realce]);

  useEffect(() => {
    const pendentes = Object.values(estados).some((e) => e === 'pendente' || e === 'salvando');
    if (!pendentes) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [estados]);

  const valoresDosEstados = Object.values(estados);
  const statusGlobal = valoresDosEstados.includes('conflito')
    ? 'Há um conflito para resolver nesta seção.'
    : valoresDosEstados.includes('erro')
      ? 'Algumas mudanças não foram salvas.'
      : valoresDosEstados.some((e) => e === 'salvando' || e === 'pendente')
        ? 'Salvando…'
        : ultimoSalvo
          ? `Tudo salvo às ${ultimoSalvo.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
          : 'As mudanças salvam sozinhas.';

  function irPara(chave: string, campo: string | null = null) {
    setAtiva(chave);
    setRealce(campo);
    if (!campo) requestAnimationFrame(() => topoDaSecao.current?.focus());
  }

  async function salvarCampo(fieldKey: string, valor: unknown, versaoEsperada: number): Promise<ResultadoDoSalvar> {
    const r = await salvarCampoAcao(clienteId, fieldKey, valor, versaoEsperada);
    if (r.ok) {
      setEntradas((atual) => {
        const proximo = { ...atual };
        if (r.valor) proximo[fieldKey] = r.valor;
        else delete proximo[fieldKey];
        return proximo;
      });
    }
    return paraResultado(r);
  }

  async function recarregarCampo(fieldKey: string) {
    const r = await recarregarContextoAcao(clienteId);
    if (!r.ok) return null;
    const entrada = r.valor.campos[fieldKey];
    setEntradas({ ...r.valor.campos });
    return { valor: entrada?.valor ?? null, versao: entrada?.versao ?? 0 };
  }

  async function marcarCampo(fieldKey: string, epistemico: Epistemico) {
    const entrada = entradas[fieldKey];
    if (!entrada) return;
    const r = await marcarAcao(clienteId, { tipo: 'campo', fieldKey }, entrada.versao, { epistemico });
    if (r.ok) setEntradas((a) => ({ ...a, [fieldKey]: r.valor as EntradaDeCampo }));
    else setAviso(r.erro);
  }

  async function confirmarCampo(fieldKey: string) {
    const entrada = entradas[fieldKey];
    if (!entrada) return;
    const r = await confirmarSugestaoAcao(clienteId, { tipo: 'campo', fieldKey }, entrada.versao);
    if (r.ok) setEntradas((a) => ({ ...a, [fieldKey]: r.valor as EntradaDeCampo }));
    else setAviso(r.erro);
  }

  async function marcarItem(listKey: string, item: ItemDeLista, marcacao: { epistemico?: Epistemico; confirmar?: boolean }) {
    const r = marcacao.confirmar
      ? await confirmarSugestaoAcao(clienteId, { tipo: 'item', itemId: item.id }, item.versao)
      : await marcarAcao(clienteId, { tipo: 'item', itemId: item.id }, item.versao, { epistemico: marcacao.epistemico });
    if (r.ok) setListas((a) => ({ ...a, [listKey]: (a[listKey] ?? []).map((i) => (i.id === item.id ? (r.valor as ItemDeLista) : i)) }));
    else setAviso(r.erro);
  }

  async function compartilhar(valor: boolean) {
    const r = await compartilharSecaoAcao(clienteId, secao.key, valor);
    if (!r.ok) {
      setAviso(r.erro);
      return;
    }
    setEntradas({ ...r.valor.campos });
    setListas({ ...r.valor.listas });
    setAviso(valor ? vocabulario.avisoDeCompartilhou : vocabulario.avisoDeDescompartilhou);
  }

  async function abrirHistorico() {
    historico.current?.showModal();
    setRevisoes(null);
    const r = await listarRevisoesAcao(clienteId, null);
    setRevisoes(r.ok ? r.valor : []);
  }

  async function recarregarTudo() {
    const r = await recarregarContextoAcao(clienteId);
    if (!r.ok) return;
    setEntradas({ ...r.valor.campos });
    setListas({ ...r.valor.listas });
    setArquivos(r.valor.arquivos);
    setEstados({});
    setGeracao((g) => g + 1);
  }

  const visiveisAoCliente = secao.campos.filter((c) => c.visivelAoCliente).map((c) => c.key);
  const respostasDaSecao = [
    ...Object.values(entradas).filter((e) => e.secao === secao.key && visiveisAoCliente.includes(e.fieldKey)),
    ...Object.values(listas).flat().filter((i) => i.secao === secao.key && visiveisAoCliente.includes(i.listKey)),
  ];
  const secaoCompartilhada = respostasDaSecao.length > 0 && respostasDaSecao.every((r) => r.compartilhavel);

  function arquivosDoCampo(campo: CampoSimples & { tipo: 'arquivo' }, listKey: string | null, itemId: string | null) {
    const doCampo = arquivos.filter((a) => a.fieldKey === campo.key && a.itemId === itemId);
    return (
      <EnvioDeArquivo
        id={`envio-${campo.key}-${itemId ?? 'campo'}`}
        endpoint={`/api/contexto/${clienteId}/arquivos`}
        fieldKey={campo.key}
        listKey={listKey}
        itemId={itemId}
        categorias={campo.categorias}
        maxArquivos={campo.maxArquivos}
        arquivos={doCampo}
        desabilitado={!podeEditar}
        indisponivel={dados.brain.armazenamentoConfigurado ? null : 'O envio de arquivos ainda não está ligado neste ambiente.'}
        aoEnviar={(a: ArquivoEnviado & { criadoEm?: string }) =>
          setArquivos((atual) => [
            ...atual,
            {
              id: a.id,
              secao: secao.key,
              fieldKey: campo.key,
              itemId,
              caminho: '',
              nome: a.nome,
              mime: a.mime,
              tamanhoBytes: a.tamanhoBytes,
              sha256: '',
              fonte: 'equipe',
              compartilhavel: false,
              criadoEm: a.criadoEm ? new Date(a.criadoEm) : new Date(),
            },
          ])
        }
        aoRemover={async (id) => {
          const r = await removerArquivoAcao(clienteId, id);
          if (r.ok) setArquivos((atual) => atual.filter((x) => x.id !== id));
          else setAviso(r.erro);
        }}
      />
    );
  }

  function renderizarCampo(campo: Campo) {
    if (campo.tipo === 'lista') {
      const itens = listas[campo.key] ?? [];
      return (
        <ListaEditavel
          key={`${campo.key}-${geracao}`}
          lista={campo}
          idBase={`ctx-${secao.key}`}
          itens={itens.map(itemDaUi)}
          desabilitado={!podeEditar}
          realce={realce === campo.key}
          adicionar={async (d) => {
            const r = paraLista(await adicionarItemAcao(clienteId, campo.key, d));
            if (r.ok) setListas((a) => ({ ...a, [campo.key]: [...(a[campo.key] ?? []), r.valor] }));
            return r.ok ? { ok: true, valor: itemDaUi(r.valor) } : r;
          }}
          alterar={async (item, d) => {
            const r = paraLista(await alterarItemAcao(clienteId, item.id, d, item.versao));
            if (r.ok) setListas((a) => ({ ...a, [campo.key]: (a[campo.key] ?? []).map((i) => (i.id === item.id ? r.valor : i)) }));
            return r.ok ? { ok: true, valor: itemDaUi(r.valor) } : r;
          }}
          remover={async (item) => {
            const r = paraLista(await removerItemAcao(clienteId, item.id, item.versao));
            if (r.ok) setListas((a) => ({ ...a, [campo.key]: (a[campo.key] ?? []).filter((i) => i.id !== item.id) }));
            return r;
          }}
          reordenar={async (ordem) => {
            const r = await reordenarAcao(clienteId, campo.key, ordem);
            if (r.ok) setListas((a) => ({ ...a, [campo.key]: r.valor }));
            return r.ok;
          }}
          aoMudarItens={(novos) =>
            setListas((a) => {
              const porId = new Map((a[campo.key] ?? []).map((i) => [i.id, i]));
              return { ...a, [campo.key]: novos.map((n) => porId.get(n.id)).filter((i): i is ItemDeLista => Boolean(i)) };
            })
          }
          selosDoItem={(ui) => {
            const item = itens.find((i) => i.id === ui.id);
            return item ? (
              <IndicadorDoCampo
                vocabulario={vocabulario}
                marcacao={item}
                interno={false}
                herdado={false}
                podeEditar={podeEditar}
                aoMarcar={(ep) => void marcarItem(campo.key, item, { epistemico: ep })}
                aoConfirmar={() => void marcarItem(campo.key, item, { confirmar: true })}
              />
            ) : null;
          }}
          arquivosDoItem={(ui, sub) => (sub.tipo === 'arquivo' ? arquivosDoCampo(sub, campo.key, ui.id) : null)}
          selos={campo.key === 'produtos' ? <span className="selo selo--dica">CSV: use “Planilha ou feed” abaixo</span> : undefined}
        />
      );
    }
    if (campo.tipo === 'arquivo') {
      return (
        <div key={campo.key} className={`campo campo--arquivo${realce === campo.key ? ' campo--realce' : ''}`} data-campo={campo.key}>
          <div className="campo__cabeca">
            <span className="campo__rotulo">
              {campo.rotulo}
              {campo.nivel === 'essencial' ? <span className="campo__essencial">essencial</span> : null}
            </span>
          </div>
          {campo.ajuda ? <p className="field__hint">{campo.ajuda}</p> : null}
          {arquivosDoCampo(campo, null, null)}
        </div>
      );
    }
    const entrada = entradas[campo.key];
    return (
      <CampoAutosalvo
        key={`${campo.key}-${geracao}`}
        campo={campo}
        idBase={`ctx-${secao.key}`}
        valorInicial={entrada?.valor ?? null}
        versaoInicial={entrada?.versao ?? 0}
        versao={entrada?.versao ?? 0}
        salvar={(v, versao) => salvarCampo(campo.key, v, versao)}
        recarregar={() => recarregarCampo(campo.key)}
        aoEstado={aoEstado}
        desabilitado={!podeEditar}
        realce={realce === campo.key}
        selos={
          <IndicadorDoCampo
            vocabulario={vocabulario}
            marcacao={entrada && !campoEhHerdado(entrada) ? entrada : null}
            interno={!campo.visivelAoCliente}
            herdado={Boolean(entrada && campoEhHerdado(entrada))}
            podeEditar={podeEditar}
            aoMarcar={(ep) => void marcarCampo(campo.key, ep)}
            aoConfirmar={() => void confirmarCampo(campo.key)}
          />
        }
      />
    );
  }

  const essenciais = secao.campos.filter((c) => c.nivel === 'essencial');
  const aprofundar = secao.campos.filter((c) => c.nivel === 'aprofundar');
  const completudeAtiva = completude.secoes.find((x) => x.secao === secao.key);
  const barrasAtivas = completudeAtiva ? barrasDaSecao(completudeAtiva) : null;
  const aprofundarFeitos = barrasAtivas?.aprofundar.feitos ?? 0;
  const aprofundarAberto =
    aprofundar.some((c) => c.key === realce) ||
    aprofundar.some((c) => (c.tipo === 'lista' ? (listas[c.key]?.length ?? 0) > 0 : Boolean(entradas[c.key])));

  return (
    <div className="editor">
      <div className="editor__barra">
        <p className="editor__status" role="status" aria-live="polite">
          <span className={`editor__ponto${statusGlobal === 'Salvando…' ? ' editor__ponto--salvando' : ''}`} aria-hidden="true" />
          {statusGlobal}
        </p>
        <div className="editor__destaques" aria-label="Atalhos">
          {DESTAQUES.map((d) => (
            <button key={d.campo} type="button" className="chip" onClick={() => irPara(d.secao, d.campo)}>
              {d.campo === 'descricao_do_cliente' ? vocabulario.descricaoDoCliente : d.rotulo}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn--compacto" onClick={() => void abrirHistorico()}>
          Histórico
        </button>
      </div>

      {aviso ? (
        <p className="alert alert--info editor__aviso" role="status">
          {aviso}
          <button type="button" className="linkish" onClick={() => setAviso(null)}>ok</button>
        </p>
      ) : null}
      {valoresDosEstados.includes('conflito') ? (
        <p className="alert alert--warn" role="alert">
          Alguém mudou este contexto enquanto você editava. Resolva campo a campo ou{' '}
          <button type="button" className="linkish" onClick={() => void recarregarTudo()}>recarregue tudo</button> (mudanças não salvas se perdem).
        </p>
      ) : null}

      <div className="editor__corpo">
        <nav className="passos" aria-label="Seções do mapa de contexto">
          <label className="passos__seletor">
            <span className="visualmente-oculto">Ir para a seção</span>
            <select className="select" value={ativa} onChange={(e) => irPara(e.target.value)}>
              {catalogo.map((s) => {
                const c = completude.secoes.find((x) => x.secao === s.key);
                return <option key={s.key} value={s.key}>{s.letra} · {s.titulo} — {c ? barrasDaSecao(c).progresso : 0}%</option>;
              })}
            </select>
          </label>
          <ol className="passos__lista">
            {catalogo.map((s: Secao) => {
              const c = completude.secoes.find((x) => x.secao === s.key);
              const b = c ? barrasDaSecao(c) : null;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    className={`passo passo--${b?.estado ?? 'vazia'}`}
                    aria-current={s.key === ativa ? 'step' : undefined}
                    onClick={() => irPara(s.key)}
                  >
                    <span className="passo__letra" aria-hidden="true">{b?.estado === 'completa' || b?.estado === 'essencial_ok' ? '✓' : s.letra}</span>
                    <span className="passo__texto">
                      <span className="passo__titulo">{s.titulo}</span>
                      <span className="passo__barras">
                        <Barra valor={b?.progresso ?? 0} rotulo={`${s.titulo}, progresso`} />
                      </span>
                    </span>
                    <span className="passo__pct">{b?.progresso ?? 0}%</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="card secao-editor" aria-labelledby="secao-titulo">
          <header className="secao-editor__topo">
            <span className="secao-editor__letra" aria-hidden="true">{secao.letra}</span>
            <div className="secao-editor__textos">
              <h2 className="secao-editor__titulo" id="secao-titulo" tabIndex={-1} ref={topoDaSecao}>
                {secao.titulo}
              </h2>
              <p className="subtle small">{secao.descricao}</p>
              {secao.key === 'objetivos' || secao.key === 'restricoes' ? (
                <Link className="btn btn--compacto atalho-regras" href={rotaDoCliente(clienteId, 'regras')}>
                  Ver em Regras
                </Link>
              ) : null}
            </div>
            {podeEditar ? (
              <label className="interruptor" title={vocabulario.dicaDeCompartilhar}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={secaoCompartilhada}
                  disabled={respostasDaSecao.length === 0}
                  onChange={(e) => void compartilhar(e.target.checked)}
                />
                <span className="interruptor__trilho" aria-hidden="true" />
                <span className="small">{vocabulario.rotuloDeCompartilhar}</span>
              </label>
            ) : null}
          </header>

          <div className="secao-editor__campos" key={secao.key}>
            {secao.key === 'empresa' ? (
              <section className="cadastro-herdado" aria-label={noVocabularioDe(tipo, 'Dados do cadastro do cliente')}>
                <dl className="cadastro-herdado__lista">
                  <div className="cadastro-herdado__item">
                    <dt>Modelo de negócio</dt>
                    <dd>{dados.cadastro.modeloDeOperacao === 'ecommerce' ? 'E-commerce' : 'Geração de leads'}</dd>
                  </div>
                  <div className="cadastro-herdado__item">
                    <dt>Pertence a uma rede</dt>
                    <dd>{dados.cadastro.temRede ? (dados.cadastro.redeNome ? `Sim, filial de ${dados.cadastro.redeNome}` : 'Sim') : 'Não'}</dd>
                  </div>
                </dl>
                <p className="cadastro-herdado__nota xsmall subtle">{noVocabularioDe(tipo, 'Vêm do cadastro do cliente e não se editam aqui.')}</p>
              </section>
            ) : null}
            <div className="nivel nivel--essencial">
              <h3 className="nivel__titulo">Essencial</h3>
              {essenciais.map(renderizarCampo)}
            </div>
            {aprofundar.length > 0 ? (
              <details className="nivel nivel--aprofundar" open={aprofundarAberto}>
                <summary className="nivel__titulo">
                  Aprofundar <span className="subtle xsmall">opcional, melhora o resultado · {aprofundarFeitos} de {aprofundar.length} campos</span>
                </summary>
                <Barra valor={barrasAtivas?.aprofundar.percentual ?? 0} rotulo={`${secao.titulo}, aprofundar`} tom="suave" />
                {aprofundar.map(renderizarCampo)}
              </details>
            ) : null}
          </div>

          <footer className="secao-editor__rodape">
            <button type="button" className="btn" disabled={indice === 0} onClick={() => irPara(catalogo[indice - 1]!.key)}>
              ← {indice > 0 ? catalogo[indice - 1]!.titulo : 'Anterior'}
            </button>
            <button type="button" className="btn btn--primary" disabled={indice === catalogo.length - 1} onClick={() => irPara(catalogo[indice + 1]!.key)}>
              {indice < catalogo.length - 1 ? catalogo[indice + 1]!.titulo : 'Próxima'} →
            </button>
          </footer>
        </section>
      </div>

      <dialog ref={historico} className="painel-lateral" aria-labelledby="t-historico">
        <div className="painel-lateral__topo">
          <h2 className="modal__titulo" id="t-historico">Histórico de revisões</h2>
          <button type="button" className="menu-botao painel-lateral__fechar" aria-label="Fechar" onClick={() => historico.current?.close()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="painel-lateral__corpo">
          {revisoes === null ? (
            <p className="subtle" role="status">Carregando…</p>
          ) : revisoes.length === 0 ? (
            <p className="subtle">Nenhuma revisão ainda.</p>
          ) : (
            <ol className="revisoes">
              {revisoes.map((r) => (
                <li key={r.id} className="revisao">
                  <div className="revisao__topo">
                    <span className="strong small">{catalogo.find((s) => s.key === r.secao)?.letra ?? ''} · {r.chave}</span>
                    <span className="pill">{r.viaLink ? 'cliente' : 'equipe'}</span>
                    <time className="subtle xsmall" dateTime={new Date(r.em).toISOString()}>{new Date(r.em).toLocaleString('pt-BR')}</time>
                  </div>
                  {r.diferencas.length > 0 ? (
                    <ul className="revisao__difs">
                      {r.diferencas.slice(0, 6).map((d) => (
                        <li key={d.chave}>
                          <span className="mono">{d.chave}</span>:{' '}
                          <del>{d.antes === null || d.antes === undefined ? '∅' : JSON.stringify(d.antes).slice(0, 80)}</del>{' '}→{' '}
                          <ins>{d.depois === null || d.depois === undefined ? '∅' : JSON.stringify(d.depois).slice(0, 80)}</ins>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="subtle xsmall">{r.operacao}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </dialog>
    </div>
  );
}
