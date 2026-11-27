'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { aprovarSugestoesAcao, corrigirFalhaDoGateAcao, type EstadoDasSugestoes } from '@/../app/clientes/[id]/(painel)/estrategia/acoes';
import type { LacunasNaTela } from '@/modules/strategy/interface/visaoDoPlano';
import type { FalhaDoGate } from '@/modules/strategy/interface/falhaDoGate';

type Props = {
  readonly clienteId: string;
  readonly planoId: string;
  readonly lacunas: LacunasNaTela | null;
  readonly falhaDoGate: FalhaDoGate | null;
};

function Ocultos({ clienteId, planoId }: { readonly clienteId: string; readonly planoId: string }) {
  return (
    <>
      <input type="hidden" name="clienteId" value={clienteId} />
      <input type="hidden" name="planoId" value={planoId} />
    </>
  );
}

function AvisoDeFalhaDoGate({ clienteId, planoId, falha }: { readonly clienteId: string; readonly planoId: string; readonly falha: FalhaDoGate }) {
  return (
    <section className="alert alert--error" role="alert" aria-label="Conferência do plano">
      <Icone nome="erro" />
      <div className="estrategia-aviso">
        <p className="estrategia-aviso__titulo">{falha.motivoLegivel}</p>
        <ul className="estrategia-aviso__itens">
          {falha.falhas.map((item) => (
            <li key={item.gate}>
              <strong>{item.gate}</strong>
              <ul>
                {item.itens.map((texto) => (
                  <li key={texto}>{texto}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <form action={corrigirFalhaDoGateAcao}>
          <Ocultos clienteId={clienteId} planoId={planoId} />
          {falha.possivel ? (
            <BotaoDeEnvio className="btn btn--primary" pendente="Pedindo…">
              Corrigir falha do Gate com IA
            </BotaoDeEnvio>
          ) : (
            <button type="button" className="btn" disabled>
              Corrigir falha do Gate com IA
            </button>
          )}
        </form>
      </div>
    </section>
  );
}

const ESTADO_INICIAL: EstadoDasSugestoes = {};

function BlocoDeLacunas({ clienteId, planoId, lacunas }: { readonly clienteId: string; readonly planoId: string; readonly lacunas: LacunasNaTela }) {
  const [estado, enviar] = useActionState(aprovarSugestoesAcao, ESTADO_INICIAL);
  return (
    <section className="card" aria-labelledby="titulo-lacunas">
      <div className="card__head">
        <h3 className="card__title" id="titulo-lacunas">
          O que falta saber do cliente
        </h3>
      </div>
      <form className="card__body" action={enviar}>
        <Ocultos clienteId={clienteId} planoId={planoId} />
        {estado.erro ? (
          <div className="alert alert--error" role="alert">
            <Icone nome="erro" />
            <span>{estado.erro}</span>
          </div>
        ) : null}
        <ul className="lacunas-lista">
          {lacunas.itens.map((lacuna) => {
            const erro = estado.porLacuna?.[lacuna.id];
            return (
              <li key={lacuna.id} className="lacunas-lista__item">
                {lacuna.podeAprovar ? (
                  <label className="lacunas-lista__marca">
                    <input type="checkbox" name="lacunaId" value={lacuna.id} defaultChecked />
                    <span>{lacuna.descricao}</span>
                  </label>
                ) : (
                  <span>{lacuna.descricao}</span>
                )}
                <span className="subtle">{lacuna.origemRotulo}</span>
                {lacuna.textoEditavel !== null ? (
                  <label className="field">
                    <span className="field__label">Valor sugerido (você pode editar)</span>
                    <input className="input" name={`valor:${lacuna.id}`} defaultValue={lacuna.textoEditavel} aria-invalid={erro ? true : undefined} />
                  </label>
                ) : lacuna.valorLegivel ? (
                  <span>Sugestão: {lacuna.valorLegivel}</span>
                ) : null}
                {lacuna.justificativa ? <span className="subtle">Por quê: {lacuna.justificativa}</span> : null}
                {erro ? (
                  <span className="field__erro" role="alert">
                    <Icone nome="erro" tamanho={14} /> {erro}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="estrategia-form__rodape">
          {lacunas.podeAprovar ? (
            <BotaoDeEnvio className="btn btn--primary" pendente="Aprovando…">
              {lacunas.textoDoBotao}
            </BotaoDeEnvio>
          ) : null}
          <Link className="btn" href={lacunas.regrasHref}>
            Definir em Regras
          </Link>
        </div>
      </form>
    </section>
  );
}

export function EncaixesDoPlano({ clienteId, planoId, lacunas, falhaDoGate }: Props) {
  return (
    <>
      {falhaDoGate ? <AvisoDeFalhaDoGate clienteId={clienteId} planoId={planoId} falha={falhaDoGate} /> : null}
      {lacunas ? <BlocoDeLacunas clienteId={clienteId} planoId={planoId} lacunas={lacunas} /> : null}
    </>
  );
}
