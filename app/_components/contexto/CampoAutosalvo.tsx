'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CampoSimples } from '@/modules/clients/domain/contexto/catalogo';
import { Entrada } from '@/../app/_components/contexto/Entrada';
import { valorParaServidor, valorParaUi, type ValorDaUi } from '@/../app/_components/contexto/valoresDaUi';

export type ResultadoDoSalvar =
  | { readonly ok: true; readonly versao: number }
  | { readonly ok: false; readonly erro: string; readonly conflito: boolean; readonly versaoAtual: number | null };

export type EstadoDoSalvar = 'ocioso' | 'pendente' | 'salvando' | 'salvo' | 'erro' | 'conflito';

export const ESPERA_DO_AUTOSAVE_MS = 900;

type Props = {
  readonly campo: CampoSimples;
  readonly idBase: string;
  readonly valorInicial: unknown;
  readonly versaoInicial: number;
  readonly versao?: number;
  readonly salvar: (valor: unknown, versaoEsperada: number) => Promise<ResultadoDoSalvar>;
  readonly recarregar?: () => Promise<{ readonly valor: unknown; readonly versao: number } | null>;
  readonly aoEstado?: (chave: string, estado: EstadoDoSalvar) => void;
  readonly desabilitado?: boolean;
  readonly selos?: ReactNode;
  readonly rodape?: ReactNode;
  readonly realce?: boolean;
};

const ROTULO_DO_ESTADO: Partial<Record<EstadoDoSalvar, string>> = {
  pendente: 'editando…',
  salvando: 'salvando…',
  salvo: 'salvo',
  erro: 'não salvo',
  conflito: 'conflito',
};

export function CampoAutosalvo({ campo, idBase, valorInicial, versaoInicial, versao: versaoExterna, salvar, recarregar, aoEstado, desabilitado, selos, rodape, realce }: Props) {
  const [valor, setValor] = useState<ValorDaUi>(() => valorParaUi(campo, valorInicial));
  const [estado, setEstado] = useState<EstadoDoSalvar>('ocioso');
  const [erro, setErro] = useState<string | null>(null);
  const versao = useRef(versaoInicial);
  const salvoPorUltimo = useRef(JSON.stringify(valorParaServidor(campo, valorParaUi(campo, valorInicial))));
  const versaoAtualDoConflito = useRef<number | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atual = useRef(valor);
  const bloco = useRef<HTMLDivElement>(null);
  const id = `${idBase}-${campo.key}`;

  useEffect(() => {
    if (realce) {
      bloco.current?.scrollIntoView({ block: 'center' });
      bloco.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true });
    }
  }, [realce]);

  useEffect(() => () => {
    if (relogio.current) clearTimeout(relogio.current);
  }, []);

  useEffect(() => {
    if (versaoExterna !== undefined && estado !== 'salvando' && estado !== 'conflito') versao.current = versaoExterna;
  }, [versaoExterna, estado]);

  function mudarEstado(novo: EstadoDoSalvar) {
    setEstado(novo);
    aoEstado?.(campo.key, novo);
  }

  async function gravar(versaoEsperada = versao.current) {
    if (relogio.current) {
      clearTimeout(relogio.current);
      relogio.current = null;
    }
    const paraServidor = valorParaServidor(campo, atual.current);
    const serializado = JSON.stringify(paraServidor);
    if (serializado === salvoPorUltimo.current && versaoEsperada === versao.current) {
      mudarEstado(estado === 'ocioso' ? 'ocioso' : 'salvo');
      return;
    }
    mudarEstado('salvando');
    const resultado = await salvar(paraServidor, versaoEsperada);
    if (resultado.ok) {
      versao.current = resultado.versao;
      salvoPorUltimo.current = serializado;
      setErro(null);
      mudarEstado(JSON.stringify(valorParaServidor(campo, atual.current)) === serializado ? 'salvo' : 'pendente');
      if (JSON.stringify(valorParaServidor(campo, atual.current)) !== serializado) agendar();
      return;
    }
    if (resultado.conflito) {
      versaoAtualDoConflito.current = resultado.versaoAtual;
      setErro(resultado.erro);
      mudarEstado('conflito');
      return;
    }
    setErro(resultado.erro);
    mudarEstado('erro');
  }

  function agendar() {
    if (relogio.current) clearTimeout(relogio.current);
    relogio.current = setTimeout(() => void gravar(), ESPERA_DO_AUTOSAVE_MS);
  }

  function aoMudar(novo: ValorDaUi) {
    setValor(novo);
    atual.current = novo;
    if (estado === 'conflito') return;
    mudarEstado('pendente');
    agendar();
  }

  function aoSair() {
    if (estado === 'pendente') void gravar();
  }

  async function usarAtual() {
    if (!recarregar) return;
    const servidor = await recarregar();
    if (!servidor) return;
    const ui = valorParaUi(campo, servidor.valor);
    setValor(ui);
    atual.current = ui;
    versao.current = servidor.versao;
    salvoPorUltimo.current = JSON.stringify(valorParaServidor(campo, ui));
    setErro(null);
    mudarEstado('salvo');
  }

  function manterMinha() {
    const alvo = versaoAtualDoConflito.current ?? versao.current;
    versao.current = alvo;
    salvoPorUltimo.current = '__forcar__';
    void gravar(alvo);
  }

  const dica = campo.ajuda ? `${id}-ajuda` : undefined;
  const descritoPor = [dica, erro ? `${id}-erro` : null].filter(Boolean).join(' ') || undefined;

  return (
    <div ref={bloco} className={`campo campo--${campo.tipo}${realce ? ' campo--realce' : ''}${estado === 'conflito' ? ' campo--conflito' : ''}`} data-campo={campo.key}>
      <div className="campo__cabeca">
        <label className="campo__rotulo" id={`${id}-rotulo`} htmlFor={id}>
          {campo.rotulo}
          {campo.nivel === 'essencial' ? <span className="campo__essencial" title="Essencial">essencial</span> : null}
        </label>
        {selos}
        <span className={`campo__estado campo__estado--${estado}`} aria-hidden="true">{ROTULO_DO_ESTADO[estado] ?? ''}</span>
      </div>
      {campo.ajuda ? <p className="field__hint" id={dica}>{campo.ajuda}</p> : null}
      <Entrada
        campo={campo}
        id={id}
        valor={valor}
        aoMudar={aoMudar}
        aoSair={aoSair}
        desabilitado={desabilitado}
        descritoPor={descritoPor}
        invalido={estado === 'erro'}
      />
      {estado === 'erro' && erro ? (
        <p className="campo__erro" id={`${id}-erro`} role="alert">
          {erro}{' '}
          <button type="button" className="linkish" onClick={() => void gravar()}>Tentar de novo</button>
        </p>
      ) : null}
      {estado === 'conflito' ? (
        <div className="campo__conflito" id={`${id}-erro`} role="alert">
          <span>{erro ?? 'Outra pessoa alterou esta informação.'} Seu texto continua aqui.</span>
          <span className="row">
            {recarregar ? <button type="button" className="btn btn--compacto" onClick={() => void usarAtual()}>Usar a versão atual</button> : null}
            <button type="button" className="btn btn--compacto btn--primary" onClick={manterMinha}>Manter a minha</button>
          </span>
        </div>
      ) : null}
      {rodape}
    </div>
  );
}
