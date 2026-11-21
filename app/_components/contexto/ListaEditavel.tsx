'use client';

import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import type { CampoLista, CampoSimples } from '@/modules/clients/domain/contexto/catalogo';
import { rotuloDaOpcao } from '@/modules/clients/domain/contexto/valores';
import { formatarCentavos } from '@/modules/clients/domain/painel/formato';
import { Entrada } from '@/../app/_components/contexto/Entrada';
import { valorParaServidor, valorParaUi, type ValorDaUi } from '@/../app/_components/contexto/valoresDaUi';

export type ItemDaLista = {
  readonly id: string;
  readonly dados: Readonly<Record<string, unknown>>;
  readonly versao: number;
  readonly removivel: boolean;
  readonly editavel: boolean;
};

export type RespostaDaLista<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly erro: string; readonly campos?: Readonly<Record<string, string>> | null };

type Props = {
  readonly lista: CampoLista;
  readonly idBase: string;
  readonly itens: readonly ItemDaLista[];
  readonly desabilitado?: boolean;
  readonly realce?: boolean;
  readonly adicionar: (dados: Record<string, unknown>) => Promise<RespostaDaLista<ItemDaLista>>;
  readonly alterar: (item: ItemDaLista, dados: Record<string, unknown>) => Promise<RespostaDaLista<ItemDaLista>>;
  readonly remover: (item: ItemDaLista) => Promise<RespostaDaLista<null>>;
  readonly reordenar?: (ordem: readonly string[]) => Promise<boolean>;
  readonly aoMudarItens: (itens: readonly ItemDaLista[]) => void;
  readonly selosDoItem?: (item: ItemDaLista) => ReactNode;
  readonly arquivosDoItem?: (item: ItemDaLista, campo: CampoSimples) => ReactNode;
  readonly selos?: ReactNode;
};

const DESFAZER_MS = 6000;

function resumoDoValor(campo: CampoSimples, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '';
  if (campo.tipo === 'selecao') return rotuloDaOpcao(campo.opcoes, String(valor));
  if (campo.tipo === 'multipla' && Array.isArray(valor)) return valor.map((v) => rotuloDaOpcao(campo.opcoes, String(v))).join(', ');
  if (campo.tipo === 'dinheiro' && typeof valor === 'number') return `R$ ${formatarCentavos(valor)}`;
  if (campo.tipo === 'booleano') return valor ? 'Sim' : 'Não';
  if (campo.tipo === 'escala') return `${String(valor)}/5`;
  if (campo.tipo === 'numero' && campo.unidade) return `${String(valor)} ${campo.unidade}`;
  return String(valor);
}

function tituloDoItem(lista: CampoLista, dados: Readonly<Record<string, unknown>>): string {
  const principal = lista.item.find((c) => c.key === lista.campoTitulo);
  const titulo = principal ? resumoDoValor(principal, dados[lista.campoTitulo]) : '';
  return titulo || `${lista.rotuloDoItem} sem nome`;
}

function FormularioDoItem({
  lista,
  idBase,
  inicial,
  erros,
  pendente,
  aoSalvar,
  aoCancelar,
  arquivos,
}: {
  readonly lista: CampoLista;
  readonly idBase: string;
  readonly inicial: Readonly<Record<string, unknown>>;
  readonly erros: Readonly<Record<string, string>>;
  readonly pendente: boolean;
  readonly aoSalvar: (dados: Record<string, unknown>) => void;
  readonly aoCancelar: () => void;
  readonly arquivos?: (campo: CampoSimples) => ReactNode;
}) {
  const campos = lista.item;
  const [rascunho, setRascunho] = useState<Record<string, ValorDaUi>>(() =>
    Object.fromEntries(campos.filter((c) => c.tipo !== 'arquivo').map((c) => [c.key, valorParaUi(c, inicial[c.key])])),
  );
  const primeiro = useRef<HTMLDivElement>(null);

  useEffect(() => {
    primeiro.current?.querySelector<HTMLElement>('input, textarea, select')?.focus();
  }, []);

  const principais = campos.filter((c, i) => c.obrigatorio || c.key === lista.campoTitulo || i < 3);
  const detalhes = campos.filter((c) => !principais.includes(c));

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    const dados: Record<string, unknown> = {};
    for (const campo of campos) {
      if (campo.tipo === 'arquivo') continue;
      const valor = valorParaServidor(campo, rascunho[campo.key] ?? null);
      if (valor !== null) dados[campo.key] = valor;
    }
    aoSalvar(dados);
  }

  function linha(campo: CampoSimples) {
    const id = `${idBase}-${campo.key}`;
    if (campo.tipo === 'arquivo') {
      return arquivos ? (
        <div key={campo.key} className="field item-form__campo item-form__campo--largo">
          <span className="field__label">{campo.rotulo}</span>
          {arquivos(campo)}
        </div>
      ) : null;
    }
    const largo = campo.tipo === 'texto_longo' || campo.tipo === 'multipla' || campo.tipo === 'escala';
    return (
      <div key={campo.key} className={`field item-form__campo${largo ? ' item-form__campo--largo' : ''}`}>
        <label className="field__label" id={`${id}-rotulo`} htmlFor={id}>
          {campo.rotulo}
          {campo.obrigatorio ? <span className="obrigatorio" aria-hidden="true"> *</span> : null}
          {campo.obrigatorio ? <span className="visualmente-oculto"> (obrigatório)</span> : null}
        </label>
        {campo.ajuda ? <span className="field__hint">{campo.ajuda}</span> : null}
        <Entrada
          campo={campo}
          id={id}
          valor={rascunho[campo.key] ?? null}
          aoMudar={(v) => setRascunho((r) => ({ ...r, [campo.key]: v }))}
          invalido={Boolean(erros[campo.key])}
          descritoPor={erros[campo.key] ? `${id}-erro` : undefined}
        />
        {erros[campo.key] ? <span className="campo__erro" id={`${id}-erro`}>{erros[campo.key]}</span> : null}
      </div>
    );
  }

  return (
    <form className="item-form" onSubmit={enviar} aria-label={`Editar ${lista.rotuloDoItem.toLowerCase()}`}>
      <div className="item-form__grade" ref={primeiro}>
        {principais.map(linha)}
      </div>
      {detalhes.length > 0 ? (
        <details className="item-form__mais">
          <summary>Mais detalhes ({detalhes.length})</summary>
          <div className="item-form__grade">{detalhes.map(linha)}</div>
        </details>
      ) : null}
      {erros['_item'] ? <p className="campo__erro" role="alert">{erros['_item']}</p> : null}
      <div className="item-form__acoes">
        <button type="button" className="btn btn--compacto" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="btn btn--compacto btn--primary" disabled={pendente} aria-busy={pendente}>
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}

export function ListaEditavel(props: Props) {
  const { lista, idBase, itens, desabilitado, realce, adicionar, alterar, remover, reordenar, aoMudarItens, selosDoItem, arquivosDoItem, selos } = props;
  const [editando, setEditando] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [pendente, setPendente] = useState(false);
  const [removido, setRemovido] = useState<ItemDaLista | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [arrastado, setArrastado] = useState<string | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bloco = useRef<HTMLDivElement>(null);
  const ultimosItens = useRef(itens);
  ultimosItens.current = itens;
  const visiveis = itens.filter((i) => i.id !== removido?.id);
  const cheia = itens.length >= lista.maximo;

  useEffect(() => {
    if (realce) bloco.current?.scrollIntoView({ block: 'start' });
  }, [realce]);

  useEffect(() => () => {
    if (relogio.current) clearTimeout(relogio.current);
  }, []);

  async function salvar(item: ItemDaLista | null, dados: Record<string, unknown>) {
    setPendente(true);
    setErros({});
    const r = item ? await alterar(item, dados) : await adicionar(dados);
    setPendente(false);
    if (!r.ok) {
      setErros({ ...(r.campos ?? {}), ...(r.campos ? {} : { _item: r.erro }) });
      return;
    }
    aoMudarItens(item ? itens.map((i) => (i.id === item.id ? r.valor : i)) : [...itens, r.valor]);
    setEditando(null);
    setAviso(item ? 'Item atualizado.' : `Novo item salvo em “${lista.rotulo}”.`);
  }

  async function efetivarRemocao(item: ItemDaLista) {
    const r = await remover(item);
    setRemovido((atual) => (atual?.id === item.id ? null : atual));
    if (r.ok) {
      aoMudarItens(ultimosItens.current.filter((i) => i.id !== item.id));
      setAviso(null);
    } else {
      setAviso(`Não deu para remover: ${r.erro}`);
    }
  }

  function pedirRemocao(item: ItemDaLista) {
    if (removido && relogio.current) {
      clearTimeout(relogio.current);
      void efetivarRemocao(removido);
    }
    setRemovido(item);
    setAviso(null);
    relogio.current = setTimeout(() => void efetivarRemocao(item), DESFAZER_MS);
  }

  function desfazer() {
    if (relogio.current) clearTimeout(relogio.current);
    relogio.current = null;
    setRemovido(null);
    setAviso('Remoção desfeita.');
  }

  async function mover(origem: number, destino: number) {
    if (!reordenar || destino < 0 || destino >= visiveis.length || origem === destino) return;
    const nova = [...visiveis];
    const [tirado] = nova.splice(origem, 1);
    nova.splice(destino, 0, tirado!);
    const anterior = itens;
    aoMudarItens(nova);
    setAviso(`Movido para a posição ${destino + 1}.`);
    if (!(await reordenar(nova.map((i) => i.id)))) {
      aoMudarItens(anterior);
      setAviso('Não deu para reordenar agora. A lista mudou; recarregue a página.');
    }
  }

  function soltar(evento: DragEvent, destino: number) {
    evento.preventDefault();
    const origem = visiveis.findIndex((i) => i.id === arrastado);
    setArrastado(null);
    if (origem >= 0) void mover(origem, destino);
  }

  return (
    <div ref={bloco} className={`lista-editavel${realce ? ' campo--realce' : ''}`} data-campo={lista.key}>
      <div className="campo__cabeca">
        <span className="campo__rotulo" id={`${idBase}-${lista.key}-rotulo`}>
          {lista.rotulo}
          {lista.nivel === 'essencial' ? <span className="campo__essencial">essencial</span> : null}
        </span>
        {selos}
        <span className="subtle xsmall">
          {visiveis.length}
          {lista.minimo > 1 ? ` de ${lista.minimo} sugeridos` : ''}
        </span>
      </div>
      {lista.ajuda ? <p className="field__hint">{lista.ajuda}</p> : null}
      {lista.avisoDeDadoPessoal ? <p className="aviso">{lista.avisoDeDadoPessoal}</p> : null}

      <ol className="itens" aria-labelledby={`${idBase}-${lista.key}-rotulo`}>
        {visiveis.map((item, posicao) => (
          <li
            key={item.id}
            className={`item${editando === item.id ? ' item--editando' : ''}${arrastado === item.id ? ' item--arrastado' : ''}`}
            draggable={Boolean(reordenar) && !desabilitado && editando === null}
            onDragStart={() => setArrastado(item.id)}
            onDragEnd={() => setArrastado(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => soltar(e, posicao)}
          >
            {editando === item.id ? (
              <FormularioDoItem
                lista={lista}
                idBase={`${idBase}-${item.id}`}
                inicial={item.dados}
                erros={erros}
                pendente={pendente}
                aoSalvar={(dados) => void salvar(item, dados)}
                aoCancelar={() => { setEditando(null); setErros({}); }}
                arquivos={arquivosDoItem ? (campo) => arquivosDoItem(item, campo) : undefined}
              />
            ) : (
              <div className="item__linha">
                {reordenar && !desabilitado ? <span className="item__alca" aria-hidden="true">⋮⋮</span> : null}
                <div className="item__texto">
                  <span className="item__titulo">{tituloDoItem(lista, item.dados)}</span>
                  <span className="item__resumo">
                    {lista.item
                      .filter((c) => c.key !== lista.campoTitulo && c.tipo !== 'texto_longo' && c.tipo !== 'arquivo')
                      .map((c) => resumoDoValor(c, item.dados[c.key]))
                      .filter(Boolean)
                      .slice(0, 3)
                      .join(' · ')}
                  </span>
                </div>
                {selosDoItem ? selosDoItem(item) : null}
                {!desabilitado ? (
                  <div className="item__acoes">
                    {reordenar ? (
                      <>
                        <button type="button" className="btn btn--icone" aria-label={`Subir ${tituloDoItem(lista, item.dados)}`} disabled={posicao === 0} onClick={() => void mover(posicao, posicao - 1)}>↑</button>
                        <button type="button" className="btn btn--icone" aria-label={`Descer ${tituloDoItem(lista, item.dados)}`} disabled={posicao === visiveis.length - 1} onClick={() => void mover(posicao, posicao + 1)}>↓</button>
                      </>
                    ) : null}
                    {item.editavel ? (
                      <button type="button" className="btn btn--compacto" onClick={() => { setEditando(item.id); setErros({}); }}>Editar</button>
                    ) : null}
                    {item.removivel ? (
                      <button type="button" className="btn btn--compacto btn--perigo" onClick={() => pedirRemocao(item)} aria-label={`Remover ${tituloDoItem(lista, item.dados)}`}>Remover</button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </li>
        ))}
        {editando === '__novo__' ? (
          <li className="item item--editando">
            <FormularioDoItem
              lista={lista}
              idBase={`${idBase}-${lista.key}-novo`}
              inicial={{}}
              erros={erros}
              pendente={pendente}
              aoSalvar={(dados) => void salvar(null, dados)}
              aoCancelar={() => { setEditando(null); setErros({}); }}
            />
          </li>
        ) : null}
      </ol>

      {!desabilitado && editando !== '__novo__' ? (
        <button type="button" className="botao-mais" disabled={cheia} onClick={() => { setEditando('__novo__'); setErros({}); }}>
          <span aria-hidden="true">+</span> Adicionar {lista.rotuloDoItem.toLowerCase()}
          {cheia ? ` (limite de ${lista.maximo})` : ''}
        </button>
      ) : null}

      <div className="lista-editavel__aviso" aria-live="polite">
        {removido ? (
          <span className="desfazer">
            “{tituloDoItem(lista, removido.dados)}” removido.
            <button type="button" className="linkish" onClick={desfazer}>Desfazer</button>
          </span>
        ) : aviso ? (
          <span className="subtle xsmall">{aviso}</span>
        ) : null}
      </div>
    </div>
  );
}
