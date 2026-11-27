'use client';

import { useActionState, useId, useState } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { pedirMudancaAcao, type EstadoDoFormulario } from '@/../app/clientes/[id]/(painel)/estrategia/acoes';

const ESTADO_INICIAL: EstadoDoFormulario = {};
const MAXIMO = 2000;

export function FormularioDeMudanca({ clienteId, planoId, versaoId }: { readonly clienteId: string; readonly planoId: string; readonly versaoId: string }) {
  const base = useId();
  const [estado, enviar] = useActionState(pedirMudancaAcao, ESTADO_INICIAL);
  const [texto, setTexto] = useState('');
  const erro = estado.campos?.['instrucao'];

  return (
    <form className="estrategia-form" action={enviar}>
      <input type="hidden" name="clienteId" value={clienteId} />
      <input type="hidden" name="planoId" value={planoId} />
      <input type="hidden" name="versaoId" value={versaoId} />
      <div className="field">
        <label className="field__label" htmlFor={`${base}-instrucao`}>
          O que o agente deve mudar
        </label>
        <textarea
          id={`${base}-instrucao`}
          className="input textarea"
          name="instrucao"
          required
          minLength={3}
          maxLength={MAXIMO}
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          aria-invalid={erro ? true : undefined}
          aria-describedby={`${base}-dica${erro ? ` ${base}-erro` : ''}`}
        />
        <span className="field__hint" id={`${base}-dica`}>
          <span aria-live="polite">{texto.length}/{MAXIMO}</span> · Não escreva dados pessoais. A mudança volta ao Comitê e aos Gates. Verba, horizonte e objetivo só mudam editando a seção Intenção.
        </span>
        {erro ? (
          <span className="field__erro" id={`${base}-erro`} role="alert">
            <Icone nome="erro" tamanho={14} /> {erro}
          </span>
        ) : null}
        {estado.erro && !erro ? (
          <span className="field__erro" role="alert">
            <Icone nome="erro" tamanho={14} /> {estado.erro}
          </span>
        ) : null}
      </div>
      <BotaoDeEnvio className="btn btn--primary" pendente="Enviando…">
        Pedir mudança
      </BotaoDeEnvio>
    </form>
  );
}
