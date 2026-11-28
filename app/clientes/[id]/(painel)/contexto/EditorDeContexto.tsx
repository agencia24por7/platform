'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CampoAutosalvo, type EstadoDoSalvar, type ResultadoDoSalvar } from '@/../app/_components/contexto/CampoAutosalvo';
import { CampoEmLeitura } from '@/../app/_components/contexto/CampoEmLeitura';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { EnvioDeArquivo, type ArquivoEnviado } from '@/../app/_components/contexto/EnvioDeArquivo';
import { ListaEditavel, type ItemDaLista, type RespostaDaLista } from '@/../app/_components/contexto/ListaEditavel';
import { Barra } from '@/../app/clientes/[id]/_componentes/Anel';
import {
  adicionarItemAcao,
  alterarItemAcao,
  compartilharSecaoAcao,
  confirmarSugestaoAcao,
  marcarAcao,
  recarregarContextoAcao,
  removerArquivoAcao,
  removerItemAcao,
  reordenarAcao,
  salvarCampoAcao,
  type DadosDoEditor,
  type Resposta,
} from '@/../app/clientes/[id]/(painel)/contexto/acoes';
import {
  EPISTEMICOS,
  ROTULO_EPISTEMICO,
  ROTULO_FONTE,
  type Campo,
  type CampoSimples,
  type Epistemico,
} from '@/modules/clients/domain/contexto/catalogo';
import { textoDoValor } from '@/modules/clients/domain/contexto/leitura';
import { calcularCompletude } from '@/modules/clients/domain/contexto/completude';
import type { ArquivoDeContexto, EntradaDeCampo, ItemDeLista, Marcacao } from '@/modules/clients/domain/contexto/tipos';
import type { OrganizationType } from '@/modules/organizations/domain/organization';
import { noVocabularioDe, vocabularioDe, type Vocabulario } from '@/modules/organizations/domain/vocabulario';
import { campoEhHerdado } from '@/modules/clients/domain/contexto/heranca';
import { traduzirCatalogo } from '@/modules/clients/domain/contexto/vocabulario';
import { catalogoDaVisao, type VisaoDoContexto } from '@/modules/clients/domain/contexto/visaoDoCliente';
import { rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { PASSO_DO_DESTINO, resumoDoMapa, vizinhosDoPasso, type ProgressoDoDestino } from '@/modules/clients/domain/painel/mapaDeContexto';
import { barrasDaSecao } from '@/modules/clients/domain/painel/resumo';

const ESTADOS_EM_ANDAMENTO: readonly EstadoDoSalvar[] = ['pendente', 'salvando', 'erro', 'conflito'];

type Props = {
  readonly tipo: OrganizationType;
  readonly clienteId: string;
  readonly dados: DadosDoEditor;
  readonly visao: VisaoDoContexto;
  readonly podeEditar: boolean;
  readonly secaoInicial: string | null;
  readonly campoInicial: string | null;
  readonly destino: { readonly conteudo: ReactNode; readonly progresso: ProgressoDoDestino | null };
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

export function EditorDeContexto({ tipo, clienteId, dados, visao, podeEditar, secaoInicial, campoInicial, destino }: Props) {
  const vocabulario = vocabularioDe(tipo);
  const catalogo = useMemo(() => traduzirCatalogo(catalogoDaVisao(visao), tipo), [visao, tipo]);
  const [entradas, setEntradas] = useState<Record<string, EntradaDeCampo>>({ ...dados.campos });
  const [listas, setListas] = useState<Record<string, readonly ItemDeLista[]>>({ ...dados.listas });
  const [arquivos, setArquivos] = useState<readonly ArquivoDeContexto[]>(dados.arquivos);
  const [ativa, setAtiva] = useState<string>(secaoInicial && (secaoInicial === PASSO_DO_DESTINO || catalogo.some((s) => s.key === secaoInicial)) ? secaoInicial : 'empresa');
  const [realce, setRealce] = useState<string | null>(campoInicial);
  const [estados, setEstados] = useState<Record<string, EstadoDoSalvar>>({});
  const [ultimoSalvo, setUltimoSalvo] = useState<Date | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [geracao, setGeracao] = useState(0);
  const [editando, setEditando] = useState<ReadonlySet<string>>(() => new Set(campoInicial ? [campoInicial] : []));
  const fecharAoSalvar = useRef(new Set<string>());
  const navegou = useRef(false);
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

  const mapa = useMemo(() => resumoDoMapa(catalogo, completude, destino.progresso), [catalogo, completude, destino.progresso]);
  const noDestino = ativa === PASSO_DO_DESTINO && destino.progresso !== null;
  const secao = catalogo.find((s) => s.key === ativa) ?? catalogo[0]!;
  const vizinhos = vizinhosDoPasso(mapa.passos, noDestino ? PASSO_DO_DESTINO : secao.key);

  const sairDaEdicao = useCallback((chave: string) => {
    setEditando((atual) => {
      if (!atual.has(chave)) return atual;
      const proximo = new Set(atual);
      proximo.delete(chave);
      return proximo;
    });
  }, []);

  const aoEstado = useCallback(
    (chave: string, estado: EstadoDoSalvar) => {
      setEstados((atual) => (atual[chave] === estado ? atual : { ...atual, [chave]: estado }));
      if (estado === 'salvo') setUltimoSalvo(new Date());
      if (estado === 'salvo' && fecharAoSalvar.current.delete(chave)) sairDaEdicao(chave);
    },
    [sairDaEdicao],
  );

  function editar(chave: string) {
    navegou.current = true;
    fecharAoSalvar.current.delete(chave);
    setEditando((atual) => new Set(atual).add(chave));
    setRealce(chave);
  }

  function concluir(chave: string) {
    if (realce === chave) setRealce(null);
    if (ESTADOS_EM_ANDAMENTO.includes(estados[chave] ?? 'ocioso')) {
      fecharAoSalvar.current.add(chave);
      return;
    }
    sairDaEdicao(chave);
  }

  useEffect(() => {
    if (!navegou.current) return;
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
    navegou.current = true;
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
    const selos = (
      <IndicadorDoCampo
        vocabulario={vocabulario}
        marcacao={entrada && !campoEhHerdado(entrada) ? entrada : null}
        interno={!campo.visivelAoCliente}
        herdado={Boolean(entrada && campoEhHerdado(entrada))}
        podeEditar={podeEditar}
        aoMarcar={(ep) => void marcarCampo(campo.key, ep)}
        aoConfirmar={() => void confirmarCampo(campo.key)}
      />
    );
    const texto = textoDoValor(campo, entrada?.valor);
    if (texto !== null && !editando.has(campo.key)) {
      return (
        <CampoEmLeitura
          key={`${campo.key}-${geracao}`}
          chave={campo.key}
          rotulo={campo.rotulo}
          essencial={campo.nivel === 'essencial'}
          texto={texto}
          selos={selos}
          aoEditar={podeEditar ? () => editar(campo.key) : null}
        />
      );
    }
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
        selos={selos}
        rodape={
          editando.has(campo.key) ? (
            <button type="button" className="btn btn--compacto campo__concluir" onClick={() => concluir(campo.key)}>
              <Icone nome="ok" tamanho={14} /> Concluir
            </button>
          ) : null
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
          <div className="passos__geral">
            <span className="passos__geral-rotulo">Preenchimento geral</span>
            <span className="passos__geral-valor">{mapa.geral}%</span>
            <Barra valor={mapa.geral} rotulo="Preenchimento geral do mapa de contexto" />
            <span className="subtle xsmall">
              {mapa.concluidos} de {mapa.passos.length} com o essencial
            </span>
          </div>
          <label className="passos__seletor">
            <span className="visualmente-oculto">Ir para a seção</span>
            <select className="select" value={noDestino ? PASSO_DO_DESTINO : secao.key} onChange={(e) => irPara(e.target.value)}>
              {mapa.passos.map((passo) => (
                <option key={passo.chave} value={passo.chave}>
                  {passo.marca} · {passo.titulo}
                </option>
              ))}
            </select>
          </label>
          <ol className="passos__lista">
            {mapa.passos.map((passo) => (
              <li key={passo.chave}>
                <button
                  type="button"
                  className={`passo passo--${passo.estado}`}
                  aria-current={passo.chave === (noDestino ? PASSO_DO_DESTINO : secao.key) ? 'step' : undefined}
                  onClick={() => irPara(passo.chave)}
                >
                  <span className="passo__letra" aria-hidden="true">
                    {passo.marca}
                  </span>
                  <span className="passo__titulo">{passo.titulo}</span>
                  {passo.concluido ? <span className="visualmente-oculto">, essencial preenchido</span> : null}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {noDestino ? (
          <section className="card secao-editor" aria-labelledby="secao-titulo">
            <header className="secao-editor__topo">
              <span className="secao-editor__letra" aria-hidden="true">
                →
              </span>
              <div className="secao-editor__textos">
                <h2 className="secao-editor__titulo" id="secao-titulo" tabIndex={-1} ref={topoDaSecao}>
                  Destino
                </h2>
                <p className="subtle small">WhatsApp e landing pages que os planos de Estratégia usam nos links. {destino.progresso?.resumo}</p>
              </div>
            </header>
            <div className="secao-editor__campos">{destino.conteudo}</div>
            <footer className="secao-editor__rodape">
              <button type="button" className="btn" disabled={!vizinhos.anterior} onClick={() => vizinhos.anterior && irPara(vizinhos.anterior.chave)}>
                ← {vizinhos.anterior?.titulo ?? 'Anterior'}
              </button>
            </footer>
          </section>
        ) : (
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
              <button type="button" className="btn" disabled={!vizinhos.anterior} onClick={() => vizinhos.anterior && irPara(vizinhos.anterior.chave)}>
                ← {vizinhos.anterior?.titulo ?? 'Anterior'}
              </button>
              <button type="button" className="btn btn--primary" disabled={!vizinhos.proximo} onClick={() => vizinhos.proximo && irPara(vizinhos.proximo.chave)}>
                {vizinhos.proximo?.titulo ?? 'Próxima'} →
              </button>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
