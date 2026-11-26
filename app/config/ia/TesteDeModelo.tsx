'use client';

import { useActionState } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { IconeAlerta, IconeCheck } from '@/../app/_components/Icones';
import { testarModelo, type EstadoDoTeste } from '@/../app/config/ia/acoes';

const ESTADO_INICIAL: EstadoDoTeste = {};

export function TesteDeModelo() {
  const [estado, enviar] = useActionState(testarModelo, ESTADO_INICIAL);

  return (
    <>
      {estado.erro ? (
        <div className="alert alert--error" role="alert">
          <IconeAlerta className="alert__icone" />
          <span>{estado.erro}</span>
        </div>
      ) : null}
      {estado.resultado ? (
        <div className="alert alert--ok" role="status">
          <IconeCheck className="alert__icone" />
          <div>
            <p className="strong">Teste passou. O modelo respondeu: “{estado.resultado.saudacao}”</p>
            <p>
              {estado.resultado.tokensDeEntrada} tokens de entrada e {estado.resultado.tokensDeSaida} de saída.
            </p>
          </div>
        </div>
      ) : null}
      <form className="acoes" action={enviar}>
        <input type="hidden" name="teste" value="modelo" />
        <BotaoDeEnvio className="btn" pendente="Chamando o modelo…">
          Testar modelo
        </BotaoDeEnvio>
      </form>
    </>
  );
}
