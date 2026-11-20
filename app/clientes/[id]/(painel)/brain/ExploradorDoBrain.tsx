'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CopyButton } from '@/../app/_components/CopyButton';
import { ALTURA_DO_MAPA, LARGURA_DO_MAPA, type Mapa, type NoDoMapa } from '@/modules/clients/domain/painel/brain/mapa';
import {
  FRESCORES,
  NIVEIS_DE_SENSIBILIDADE,
  ROTULO_DA_SENSIBILIDADE,
  ROTULO_DO_AGRUPAMENTO,
  ROTULO_DO_FRESCOR,
  ROTULO_DO_TIPO,
  TIPOS_DE_ENTRADA,
  agrupamentoDe,
  type EntradaDoBrain,
} from '@/modules/clients/domain/painel/brain/tipos';

type Props = {
  readonly clienteNome: string;
  readonly entradas: readonly EntradaDoBrain[];
  readonly mapa: Mapa;
};

const USO: Record<EntradaDoBrain['sensibilidade']['usoPorAgente'], string> = {
  livre: 'Agente pode usar',
  com_cautela: 'Agente usa com cautela',
  proibido: 'Fora do alcance de agentes',
};

function dataCurta(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ExploradorDoBrain({ clienteNome, entradas, mapa }: Props) {
  const gaveta = useRef<HTMLDialogElement>(null);
  const [aberta, setAberta] = useState<EntradaDoBrain | null>(null);
  const [foco, setFoco] = useState<NoDoMapa | null>(null);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [provedor, setProvedor] = useState('');
  const [sensibilidade, setSensibilidade] = useState('');
  const [frescor, setFrescor] = useState('');
  const [listaAberta, setListaAberta] = useState(false);
  const [vista, setVista] = useState<'tabela' | 'cartoes'>('tabela');
  const termo = useDeferredValue(busca.trim().toLowerCase());
  const porUrn = useMemo(() => new Map(entradas.map((e) => [e.urn, e])), [entradas]);
  const provedores = useMemo(() => [...new Set(entradas.map((e) => e.provedor).filter((p): p is string => Boolean(p)))], [entradas]);

  const filtradas = useMemo(
    () =>
      entradas.filter((e) => {
        if (tipo && e.tipo !== tipo) return false;
        if (provedor && e.provedor !== provedor) return false;
        if (sensibilidade && e.sensibilidade.nivel !== sensibilidade) return false;
        if (frescor && e.frescor.status !== frescor) return false;
        if (!termo) return true;
        return [e.titulo, e.descricao, e.urn, ...e.tags, ...e.esquema.map((c) => c.nome)].some((t) => t.toLowerCase().includes(termo));
      }),
    [entradas, tipo, provedor, sensibilidade, frescor, termo],
  );

  function abrir(urn: string) {
    const entrada = porUrn.get(urn);
    if (!entrada) return;
    setAberta(entrada);
    gaveta.current?.showModal();
  }

  function teclado(evento: KeyboardEvent, urn: string) {
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault();
      abrir(urn);
    }
  }

  const limpar = () => {
    setBusca('');
    setTipo('');
    setProvedor('');
    setSensibilidade('');
    setFrescor('');
  };

  return (
    <>
      <section className="card mapa-vivo" aria-labelledby="t-mapa">
        <div className="card__head">
          <h2 className="card__title" id="t-mapa">Mapa vivo</h2>
          <span className="card__sub">Tamanho = cobertura · cor = frescor · tracejado = ligação que falta</span>
        </div>
        <div className="mapa-vivo__palco">
          <svg
            className="mapa-vivo__svg"
            viewBox={`0 0 ${LARGURA_DO_MAPA} ${ALTURA_DO_MAPA}`}
            role="group"
            aria-label={`Mapa do brain de ${clienteNome}. Use Tab para percorrer as entradas; a lista abaixo tem o mesmo conteúdo.`}
          >
            <defs>
              <radialGradient id="brilho-do-nucleo">
                <stop offset="0%" className="mapa-vivo__brilho-0" />
                <stop offset="100%" className="mapa-vivo__brilho-1" />
              </radialGradient>
            </defs>
            {mapa.grupos.map((grupo) => (
              <g key={`l-${grupo.agrupamento}`}>
                <line className="mapa-vivo__eixo" x1={mapa.centro.x} y1={mapa.centro.y} x2={grupo.x} y2={grupo.y} />
                {grupo.nos.map((no) => (
                  <line key={no.urn} className="mapa-vivo__ramo" x1={grupo.x} y1={grupo.y} x2={no.x} y2={no.y} />
                ))}
                {grupo.lacunas.map((lacuna) => (
                  <line key={lacuna.rotulo} className="mapa-vivo__ramo mapa-vivo__ramo--falta" x1={grupo.x} y1={grupo.y} x2={lacuna.x} y2={lacuna.y} />
                ))}
              </g>
            ))}
            <circle className="mapa-vivo__halo" cx={mapa.centro.x} cy={mapa.centro.y} r="92" fill="url(#brilho-do-nucleo)" />
            <circle className="mapa-vivo__nucleo" cx={mapa.centro.x} cy={mapa.centro.y} r="46" />
            <text className="mapa-vivo__nucleo-texto" x={mapa.centro.x} y={mapa.centro.y} textAnchor="middle" dominantBaseline="central">
              {clienteNome.length > 14 ? `${clienteNome.slice(0, 13)}…` : clienteNome}
            </text>
            {mapa.grupos.map((grupo) => (
              <g key={grupo.agrupamento} className={`mapa-vivo__grupo mapa-vivo__grupo--${grupo.agrupamento}`}>
                <circle className="mapa-vivo__hub" cx={grupo.x} cy={grupo.y} r="24" />
                <text className="mapa-vivo__hub-n" x={grupo.x} y={grupo.y} textAnchor="middle" dominantBaseline="central">
                  {grupo.total}
                </text>
                <text className="mapa-vivo__hub-rotulo" x={grupo.rotuloX} y={grupo.rotuloY} textAnchor="middle">
                  {ROTULO_DO_AGRUPAMENTO[grupo.agrupamento]}
                  {grupo.ocultos > 0 ? ` (+${grupo.ocultos})` : ''}
                </text>
                {grupo.nos.map((no, i) => (
                  <g
                    key={no.urn}
                    className={`mapa-vivo__no frescor-svg--${no.frescor}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${no.titulo}: ${ROTULO_DO_FRESCOR[no.frescor]}, cobertura ${no.cobertura}%`}
                    onClick={() => abrir(no.urn)}
                    onKeyDown={(e) => teclado(e, no.urn)}
                    onMouseEnter={() => setFoco(no)}
                    onMouseLeave={() => setFoco(null)}
                    onFocus={() => setFoco(no)}
                    onBlur={() => setFoco(null)}
                  >
                    <circle className="mapa-vivo__pulso" cx={no.x} cy={no.y} r={no.raio + 4} data-atraso={i % 5} />
                    <circle className="mapa-vivo__bola" cx={no.x} cy={no.y} r={no.raio} />
                  </g>
                ))}
                {grupo.lacunas.map((lacuna) => (
                  <a key={lacuna.rotulo} href={lacuna.href} className="mapa-vivo__falta" aria-label={`Falta: ${lacuna.rotulo}`}>
                    <circle cx={lacuna.x} cy={lacuna.y} r="9" />
                    <text x={lacuna.x} y={lacuna.y + 22} textAnchor="middle">{lacuna.rotulo.length > 18 ? `${lacuna.rotulo.slice(0, 17)}…` : lacuna.rotulo}</text>
                  </a>
                ))}
              </g>
            ))}
            {foco ? (
              <g className="mapa-vivo__dica" aria-hidden="true" pointerEvents="none">
                <rect x={Math.min(foco.x + 14, LARGURA_DO_MAPA - 250)} y={Math.max(foco.y - 46, 4)} width="240" height="42" rx="8" />
                <text x={Math.min(foco.x + 26, LARGURA_DO_MAPA - 238)} y={Math.max(foco.y - 29, 21)}>
                  {foco.titulo.length > 30 ? `${foco.titulo.slice(0, 29)}…` : foco.titulo}
                </text>
                <text className="mapa-vivo__dica-sub" x={Math.min(foco.x + 26, LARGURA_DO_MAPA - 238)} y={Math.max(foco.y - 12, 38)}>
                  {ROTULO_DO_FRESCOR[foco.frescor]} · cobertura {foco.cobertura}%
                </text>
              </g>
            ) : null}
          </svg>
          <ul className="legenda" aria-label="Legenda de frescor">
            {FRESCORES.map((f) => (
              <li key={f} className={`frescor frescor--${f}`}>
                <span className="dot" />
                {ROTULO_DO_FRESCOR[f]}
              </li>
            ))}
            <li className="legenda__falta">Ligação que falta</li>
          </ul>
        </div>
        <div className="mapa-vivo__lista">
          <button type="button" className="mapa-vivo__alternar" aria-expanded={listaAberta} aria-controls="mapa-como-lista" onClick={() => setListaAberta((v) => !v)}>
            {listaAberta ? 'Esconder a lista' : 'Ver o mapa como lista'}
          </button>
          <div className={`mapa-vivo__colunas${listaAberta ? ' mapa-vivo__colunas--aberta' : ''}`} id="mapa-como-lista">
            {mapa.grupos.map((grupo) => (
              <div key={grupo.agrupamento}>
                <h3 className="mapa-vivo__lista-titulo">
                  {ROTULO_DO_AGRUPAMENTO[grupo.agrupamento]} <span className="subtle">({grupo.total})</span>
                </h3>
                <ul className="lista-simples">
                  {entradas
                    .filter((e) => agrupamentoDe(e.tipo) === grupo.agrupamento)
                    .map((e) => (
                      <li key={e.urn}>
                        <button type="button" className="linkish" onClick={() => abrir(e.urn)}>
                          <span className={`frescor frescor--${e.frescor.status}`}><span className="dot" /></span>
                          {e.titulo}
                        </button>
                      </li>
                    ))}
                  {grupo.lacunas.map((l) => (
                    <li key={l.rotulo}>
                      <Link className="falta-link" href={l.href}>Falta: {l.rotulo}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="t-catalogo">
        <div className="card__head">
          <h2 className="card__title" id="t-catalogo">Catálogo</h2>
          <span className="card__sub">
            {filtradas.length} de {entradas.length} entradas
          </span>
          <span className="spacer" />
          <div className="segmentado" role="group" aria-label="Forma de exibir">
            <button type="button" aria-pressed={vista === 'tabela'} onClick={() => setVista('tabela')}>Tabela</button>
            <button type="button" aria-pressed={vista === 'cartoes'} onClick={() => setVista('cartoes')}>Cartões</button>
          </div>
        </div>
        <div className="catalogo__filtros">
          <label className="field catalogo__busca">
            <span className="field__label">Buscar</span>
            <input className="input" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="tabela, coluna, tag…" />
          </label>
          <label className="field">
            <span className="field__label">Tipo</span>
            <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              {TIPOS_DE_ENTRADA.map((t) => <option key={t} value={t}>{ROTULO_DO_TIPO[t]}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Plataforma</span>
            <select className="select" value={provedor} onChange={(e) => setProvedor(e.target.value)}>
              <option value="">Todas</option>
              {provedores.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Sensibilidade</span>
            <select className="select" value={sensibilidade} onChange={(e) => setSensibilidade(e.target.value)}>
              <option value="">Todas</option>
              {NIVEIS_DE_SENSIBILIDADE.map((n) => <option key={n} value={n}>{ROTULO_DA_SENSIBILIDADE[n]}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Frescor</span>
            <select className="select" value={frescor} onChange={(e) => setFrescor(e.target.value)}>
              <option value="">Todos</option>
              {FRESCORES.map((f) => <option key={f} value={f}>{ROTULO_DO_FRESCOR[f]}</option>)}
            </select>
          </label>
        </div>
        {filtradas.length === 0 ? (
          <div className="empty">
            Nada com esses filtros. <button type="button" className="linkish" onClick={limpar}>Limpar filtros</button>
          </div>
        ) : vista === 'tabela' ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Entrada</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Frescor</th>
                  <th scope="col" className="num">Cobertura</th>
                  <th scope="col">Sensibilidade</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((e) => (
                  <tr key={e.urn}>
                    <td>
                      <button type="button" className="linkish strong" onClick={() => abrir(e.urn)}>{e.titulo}</button>
                      <div className="mono subtle">{e.urn}</div>
                    </td>
                    <td>{ROTULO_DO_TIPO[e.tipo]}</td>
                    <td><span className={`frescor frescor--${e.frescor.status}`}><span className="dot" />{ROTULO_DO_FRESCOR[e.frescor.status]}</span></td>
                    <td className="num">{e.cobertura.diasComDado !== null ? `${e.cobertura.diasComDado}/90 dias` : `${Math.round(e.qualidade.completude * 100)}%`}</td>
                    <td><span className={`sensivel sensivel--${e.sensibilidade.nivel}`}>{ROTULO_DA_SENSIBILIDADE[e.sensibilidade.nivel]}{e.sensibilidade.piiPossivel ? ' · PII' : ''}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="cartoes-do-catalogo">
            {filtradas.map((e) => (
              <li key={e.urn}>
                <button type="button" className="cartao-do-catalogo" onClick={() => abrir(e.urn)}>
                  <span className="cartao-do-catalogo__topo">
                    <span className="pill">{ROTULO_DO_TIPO[e.tipo]}</span>
                    <span className={`frescor frescor--${e.frescor.status}`}><span className="dot" />{ROTULO_DO_FRESCOR[e.frescor.status]}</span>
                  </span>
                  <span className="strong">{e.titulo}</span>
                  <span className="subtle small">{e.descricao}</span>
                  <span className={`sensivel sensivel--${e.sensibilidade.nivel}`}>{ROTULO_DA_SENSIBILIDADE[e.sensibilidade.nivel]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <dialog ref={gaveta} className="painel-lateral painel-lateral--largo" aria-labelledby="t-entrada" onClose={() => setAberta(null)}>
        {aberta ? (
          <>
            <div className="painel-lateral__topo">
              <div>
                <span className="eyebrow">{ROTULO_DO_TIPO[aberta.tipo]}{aberta.provedor ? ` · ${aberta.provedor}` : ''}</span>
                <h2 className="modal__titulo" id="t-entrada">{aberta.titulo}</h2>
              </div>
              <button type="button" className="menu-botao painel-lateral__fechar" aria-label="Fechar" onClick={() => gaveta.current?.close()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="painel-lateral__corpo">
              <p>{aberta.descricao}</p>
              <div className="row">
                <span className={`frescor frescor--${aberta.frescor.status}`}><span className="dot" />{ROTULO_DO_FRESCOR[aberta.frescor.status]}</span>
                <span className={`sensivel sensivel--${aberta.sensibilidade.nivel}`}>{ROTULO_DA_SENSIBILIDADE[aberta.sensibilidade.nivel]}{aberta.sensibilidade.piiPossivel ? ' · PII possível' : ''}</span>
                <span className="pill">{USO[aberta.sensibilidade.usoPorAgente]}</span>
              </div>
              <dl className="fatos">
                <div className="fatos__item"><dt className="fatos__rotulo">URN</dt><dd className="mono">{aberta.urn}</dd></div>
                <div className="fatos__item"><dt className="fatos__rotulo">Grão</dt><dd>{aberta.grao ?? '—'}</dd></div>
                <div className="fatos__item"><dt className="fatos__rotulo">Cobertura</dt><dd>{dataCurta(aberta.cobertura.desde)} → {dataCurta(aberta.cobertura.ate)}</dd></div>
                <div className="fatos__item"><dt className="fatos__rotulo">Linhas</dt><dd>{aberta.cobertura.linhas?.toLocaleString('pt-BR') ?? '—'}</dd></div>
                <div className="fatos__item"><dt className="fatos__rotulo">Última atualização</dt><dd>{dataCurta(aberta.frescor.ultimaAtualizacao)}</dd></div>
                <div className="fatos__item"><dt className="fatos__rotulo">Completude</dt><dd>{Math.round(aberta.qualidade.completude * 100)}%</dd></div>
              </dl>
              {aberta.qualidade.avisos.length > 0 ? (
                <ul className="avisos">
                  {aberta.qualidade.avisos.map((a) => <li key={a} className="aviso">{a}</li>)}
                </ul>
              ) : null}
              {aberta.esquema.length > 0 ? (
                <div className="table-wrap">
                  <table className="table">
                    <caption className="field__label tabela__legenda">Esquema</caption>
                    <thead><tr><th scope="col">Coluna</th><th scope="col">Tipo</th><th scope="col">Descrição</th></tr></thead>
                    <tbody>
                      {aberta.esquema.map((c) => (
                        <tr key={c.nome}><td className="mono">{c.nome}</td><td className="mono">{c.tipo}</td><td>{c.descricao}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="field">
                <span className="field__label">Receita de acesso</span>
                <pre className="receita">{aberta.acesso.receita}</pre>
                <CopyButton texto={aberta.acesso.receita} rotulo={aberta.acesso.via === 'bigquery' ? 'Copiar SQL' : 'Copiar caminho'} />
              </div>
              {aberta.relacoes.length > 0 ? (
                <div className="field">
                  <span className="field__label">Relações</span>
                  <ul className="lista-simples">
                    {aberta.relacoes.map((r) => (
                      <li key={r.urn}>
                        <span className="subtle small">{r.tipo.replace('_', ' ')} </span>
                        {porUrn.has(r.urn) ? (
                          <button type="button" className="linkish mono" onClick={() => setAberta(porUrn.get(r.urn) ?? null)}>{r.urn}</button>
                        ) : (
                          <span className="mono">{r.urn}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {aberta.tags.length > 0 ? (
                <ul className="etiquetas">
                  {aberta.tags.map((t) => <li key={t} className="etiqueta">{t}</li>)}
                </ul>
              ) : null}
            </div>
          </>
        ) : null}
      </dialog>
    </>
  );
}
