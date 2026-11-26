'use client';

import { useActionState } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { CopyButton } from '@/../app/_components/CopyButton';
import { criarCredencial, type EstadoDaCredencial } from '@/../app/config/agentes/acoes';

type Props = {
  readonly ferramentas: readonly string[];
  readonly clientes: readonly { readonly id: string; readonly nome: string }[];
  readonly rotuloDosClientes: string;
  readonly validadePadrao: number;
  readonly validadeMaxima: number;
};

const ESTADO_INICIAL: EstadoDaCredencial = {};

export function FormularioDeCredencial({ ferramentas, clientes, rotuloDosClientes, validadePadrao, validadeMaxima }: Props) {
  const [estado, enviar] = useActionState(criarCredencial, ESTADO_INICIAL);

  return (
    <>
      {estado.erro ? (
        <div className="alert alert--error" role="alert">
          {estado.erro}
        </div>
      ) : null}

      {estado.criada ? (
        <div className="alert alert--ok" role="status">
          <p className="strong">Credencial “{estado.criada.nome}” criada. Copie agora: ela não será mostrada de novo.</p>
          <p className="mono">{estado.criada.segredo}</p>
          <CopyButton texto={estado.criada.segredo} rotulo="Copiar credencial" />
        </div>
      ) : null}

      <form className="form" action={enviar}>
        <label className="field">
          <span className="field__label">Nome</span>
          <input className="input" type="text" name="nome" required maxLength={80} placeholder="Agente de estratégia" />
          <span className="field__hint">Serve para reconhecer a credencial na lista e na auditoria.</span>
        </label>

        <fieldset className="field">
          <legend className="field__label">Ferramentas</legend>
          {ferramentas.map((ferramenta) => (
            <label key={ferramenta}>
              <input type="checkbox" name="ferramentas" value={ferramenta} defaultChecked /> <span className="mono">{ferramenta}</span>
            </label>
          ))}
          <span className="field__hint">Só leitura. O agente não enxerga ferramenta que não esteja marcada.</span>
        </fieldset>

        <fieldset className="field">
          <legend className="field__label">Alcance</legend>
          <label>
            <input type="radio" name="alcance" value="organizacao" defaultChecked /> Todos os {rotuloDosClientes} da organização
          </label>
          <label>
            <input type="radio" name="alcance" value="clientes" /> Só os marcados abaixo
          </label>
          {clientes.map((cliente) => (
            <label key={cliente.id}>
              <input type="checkbox" name="clienteIds" value={cliente.id} /> {cliente.nome}
            </label>
          ))}
        </fieldset>

        <label className="field">
          <span className="field__label">Validade em dias</span>
          <input className="input" type="number" name="validadeEmDias" required min={1} max={validadeMaxima} defaultValue={validadePadrao} />
          <span className="field__hint">No máximo {validadeMaxima} dias. Vencida, a credencial para de funcionar sozinha.</span>
        </label>

        <BotaoDeEnvio className="btn btn--primary" pendente="Criando…">
          Criar credencial
        </BotaoDeEnvio>
      </form>
    </>
  );
}
