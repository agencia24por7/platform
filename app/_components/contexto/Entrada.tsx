'use client';

import { useState } from 'react';
import type { CampoSimples } from '@/modules/clients/domain/contexto/catalogo';
import { formatarCentavos, mascararDinheiro, normalizarArrobaDigitado } from '@/modules/clients/domain/painel/formato';
import type { ValorDaUi } from '@/../app/_components/contexto/valoresDaUi';

type Props = {
  readonly campo: CampoSimples;
  readonly id: string;
  readonly valor: ValorDaUi;
  readonly aoMudar: (valor: ValorDaUi) => void;
  readonly aoSair?: () => void;
  readonly desabilitado?: boolean;
  readonly descritoPor?: string;
  readonly invalido?: boolean;
};

const OUTRO = '__outro__';

function Contador({ atual, max }: { readonly atual: number; readonly max: number }) {
  const perto = atual > max * 0.9;
  return (
    <span className={`contador${perto ? ' contador--perto' : ''}`} aria-hidden={!perto}>
      {atual}/{max}
    </span>
  );
}

function Selecao({ campo, id, valor, aoMudar, aoSair, desabilitado, descritoPor }: Props & { readonly campo: Extract<CampoSimples, { tipo: 'selecao' }> }) {
  const texto = typeof valor === 'string' ? valor : '';
  const conhecida = campo.opcoes.some((o) => o.valor === texto);
  const [outroAberto, setOutroAberto] = useState(texto !== '' && !conhecida);

  if (campo.opcoes.length <= 5 && !campo.permiteOutro) {
    return (
      <div className="opcoes-chip" role="radiogroup" aria-labelledby={`${id}-rotulo`} aria-describedby={descritoPor}>
        {campo.opcoes.map((o) => (
          <label key={o.valor} className="opcao-chip">
            <input type="radio" name={id} value={o.valor} checked={texto === o.valor} disabled={desabilitado} onChange={() => aoMudar(o.valor)} onBlur={aoSair} />
            <span>{o.rotulo}</span>
          </label>
        ))}
        {texto ? (
          <button type="button" className="linkish xsmall" disabled={desabilitado} onClick={() => aoMudar('')}>
            limpar
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="selecao">
      <select
        id={id}
        className="select"
        value={outroAberto ? OUTRO : texto}
        disabled={desabilitado}
        aria-describedby={descritoPor}
        onBlur={aoSair}
        onChange={(e) => {
          if (e.target.value === OUTRO) {
            setOutroAberto(true);
            aoMudar('');
            return;
          }
          setOutroAberto(false);
          aoMudar(e.target.value);
        }}
      >
        <option value="">Escolha…</option>
        {campo.opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.rotulo}</option>
        ))}
        {campo.permiteOutro ? <option value={OUTRO}>Outro…</option> : null}
      </select>
      {outroAberto ? (
        <input
          className="input"
          aria-label={`${campo.rotulo}: outro`}
          placeholder="Qual?"
          maxLength={80}
          value={texto}
          disabled={desabilitado}
          onChange={(e) => aoMudar(e.target.value)}
          onBlur={aoSair}
        />
      ) : null}
    </div>
  );
}

function Multipla({ campo, id, valor, aoMudar, aoSair, desabilitado, descritoPor }: Props & { readonly campo: Extract<CampoSimples, { tipo: 'multipla' }> }) {
  const escolhidas = Array.isArray(valor) ? (valor as readonly string[]) : [];
  const [outro, setOutro] = useState('');
  const extras = escolhidas.filter((v) => !campo.opcoes.some((o) => o.valor === v));
  const cheio = escolhidas.length >= campo.maxEscolhas;

  function alternar(v: string) {
    aoMudar(escolhidas.includes(v) ? escolhidas.filter((x) => x !== v) : [...escolhidas, v]);
  }

  function adicionarOutro() {
    const limpo = outro.trim().slice(0, 80);
    if (!limpo || escolhidas.includes(limpo) || cheio) return;
    aoMudar([...escolhidas, limpo]);
    setOutro('');
  }

  return (
    <div className="multipla" role="group" aria-labelledby={`${id}-rotulo`} aria-describedby={descritoPor}>
      <div className="opcoes-chip">
        {[...campo.opcoes.map((o) => ({ valor: o.valor, rotulo: o.rotulo })), ...extras.map((v) => ({ valor: v, rotulo: v }))].map((o) => {
          const ativa = escolhidas.includes(o.valor);
          return (
            <button
              key={o.valor}
              type="button"
              className={`opcao-chip opcao-chip--botao${ativa ? ' opcao-chip--ativa' : ''}`}
              aria-pressed={ativa}
              disabled={desabilitado || (!ativa && cheio)}
              onClick={() => alternar(o.valor)}
              onBlur={aoSair}
            >
              {ativa ? <span aria-hidden="true">✓ </span> : null}
              {o.rotulo}
            </button>
          );
        })}
      </div>
      {campo.permiteOutro ? (
        <div className="multipla__outro">
          <input
            className="input input--compacto"
            placeholder="Outro: digite e tecle Enter"
            aria-label={`${campo.rotulo}: adicionar outra opção`}
            maxLength={80}
            value={outro}
            disabled={desabilitado || cheio}
            onChange={(e) => setOutro(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                adicionarOutro();
              }
            }}
            onBlur={() => {
              adicionarOutro();
              aoSair?.();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function Escala({ campo, id, valor, aoMudar, aoSair, desabilitado, descritoPor }: Props & { readonly campo: Extract<CampoSimples, { tipo: 'escala' }> }) {
  const atual = typeof valor === 'number' ? valor : null;
  return (
    <div className="escala" role="radiogroup" aria-labelledby={`${id}-rotulo`} aria-describedby={descritoPor}>
      <span className="escala__extremo">{campo.extremos[0]}</span>
      <div className="escala__trilho">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`escala__ponto${atual !== null && n <= atual ? ' escala__ponto--cheio' : ''}`}>
            <input
              type="radio"
              name={id}
              value={n}
              checked={atual === n}
              disabled={desabilitado}
              onChange={() => aoMudar(n)}
              onBlur={aoSair}
              aria-label={`${n} de 5${n === 1 ? ` (${campo.extremos[0]})` : n === 5 ? ` (${campo.extremos[1]})` : ''}`}
            />
            <span aria-hidden="true">{n}</span>
          </label>
        ))}
      </div>
      <span className="escala__extremo">{campo.extremos[1]}</span>
    </div>
  );
}

export function Entrada(props: Props) {
  const { campo, id, valor, aoMudar, aoSair, desabilitado, descritoPor, invalido } = props;
  const texto = typeof valor === 'string' ? valor : '';
  const comuns = { id, disabled: desabilitado, 'aria-describedby': descritoPor, 'aria-invalid': invalido || undefined, onBlur: aoSair };

  switch (campo.tipo) {
    case 'texto':
      if (campo.formato === 'arroba') {
        return (
          <div className="com-prefixo">
            <input
              {...comuns}
              className="input"
              value={texto}
              maxLength={campo.max}
              autoComplete="off"
              spellCheck={false}
              placeholder="@perfil ou link"
              onChange={(e) => aoMudar(e.target.value)}
              onBlur={() => {
                const normal = normalizarArrobaDigitado(texto);
                if (normal !== texto) aoMudar(normal);
                aoSair?.();
              }}
            />
          </div>
        );
      }
      return (
        <div className="com-contador">
          <input {...comuns} className="input" value={texto} maxLength={campo.max} placeholder={campo.exemplo ?? undefined} onChange={(e) => aoMudar(e.target.value)} />
          {texto.length > campo.max * 0.7 ? <Contador atual={texto.length} max={campo.max} /> : null}
        </div>
      );
    case 'texto_longo':
      return (
        <div className="com-contador">
          <textarea
            {...comuns}
            className="input textarea"
            rows={Math.min(Math.max(3, Math.ceil(texto.length / 90) + 1), 12)}
            value={texto}
            maxLength={campo.max}
            placeholder={campo.exemplo ?? undefined}
            onChange={(e) => aoMudar(e.target.value)}
          />
          <Contador atual={texto.length} max={campo.max} />
        </div>
      );
    case 'url':
      return (
        <input
          {...comuns}
          className="input"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://"
          value={texto}
          onChange={(e) => aoMudar(e.target.value)}
          onBlur={() => {
            const limpo = texto.trim();
            if (limpo && !/^[a-z][a-z0-9+.-]*:/i.test(limpo) && limpo.includes('.')) aoMudar(`https://${limpo.replace(/^[/]+/, '')}`);
            aoSair?.();
          }}
        />
      );
    case 'numero':
      return (
        <div className="com-sufixo">
          <input {...comuns} className="input" inputMode={campo.inteiro ? 'numeric' : 'decimal'} value={texto} placeholder={campo.exemplo ?? '0'} onChange={(e) => aoMudar(e.target.value)} />
          {campo.unidade ? <span className="com-sufixo__unidade">{campo.unidade}</span> : null}
        </div>
      );
    case 'dinheiro':
      return (
        <div className="com-prefixo com-prefixo--rs">
          <span className="com-prefixo__simbolo" aria-hidden="true">R$</span>
          <input
            {...comuns}
            className="input"
            inputMode="numeric"
            placeholder="0,00"
            value={typeof valor === 'number' ? formatarCentavos(valor) : ''}
            onChange={(e) => aoMudar(mascararDinheiro(e.target.value).centavos)}
          />
        </div>
      );
    case 'escala':
      return <Escala {...props} campo={campo} />;
    case 'booleano':
      return (
        <div className="opcoes-chip" role="radiogroup" aria-labelledby={`${id}-rotulo`} aria-describedby={descritoPor}>
          {([['sim', true, 'Sim'], ['nao', false, 'Não']] as const).map(([chave, v, rotulo]) => (
            <label key={chave} className="opcao-chip">
              <input type="radio" name={id} checked={valor === v} disabled={desabilitado} onChange={() => aoMudar(v)} onBlur={aoSair} />
              <span>{rotulo}</span>
            </label>
          ))}
        </div>
      );
    case 'selecao':
      return <Selecao {...props} campo={campo} />;
    case 'multipla':
      return <Multipla {...props} campo={campo} />;
    case 'arquivo':
      return null;
  }
}
