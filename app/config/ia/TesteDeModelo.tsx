'use client';

import { useActionState } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { testarModelo, type EstadoDoTeste } from '@/../app/config/ia/acoes';

const ESTADO_INICIAL: EstadoDoTeste = {};

export function TesteDeModelo() {
  const [estado, enviar] = useActionState(testarModelo, ESTADO_INICIAL);

  return (
    <>
      {estado.erro ? (
        <div className="alert alert--error" role="alert">
          {estado.erro}
        </div>
      ) : null}
      {estado.resultado ? (
        <div className="alert alert--ok" role="status">
          <p className="strong">O modelo respondeu: “{estado.resultado.saudacao}”</p>
          <p className="muted">
            {estado.resultado.tokensDeEntrada} tokens de entrada e {estado.resultado.tokensDeSaida} de saída.
          </p>
        </div>
      ) : null}
      <form action={enviar}>
        <input type="hidden" name="teste" value="modelo" />
        <BotaoDeEnvio className="btn" pendente="Chamando o modelo…">
          Testar modelo
        </BotaoDeEnvio>
      </form>
    </>
  );
}
