'use client';

import { useActionState, useId } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { CopyButton } from '@/../app/_components/CopyButton';
import { IconeAlerta, IconeCheck } from '@/../app/_components/Icones';
import { criarCredencial, type EstadoDaCredencial } from '@/../app/config/agentes/acoes';
import { rotuloDaFerramenta } from '@/modules/ia/interface/apresentacao';

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
  const idBase = useId();
  const idDoErro = `${idBase}-erro`;
  const idDaDicaDoNome = `${idBase}-nome-dica`;
  const idDaDicaDaValidade = `${idBase}-validade-dica`;
  const semClientes = clientes.length === 0;

  return (
    <>
      <div className="card__body">
        {estado.erro ? (
          <div id={idDoErro} className="alert alert--error" role="alert">
            <IconeAlerta className="alert__icone" />
            <span>{estado.erro}</span>
          </div>
        ) : null}

        <div role="status">
          {estado.criada ? (
            <p className="alert alert--ok">
              <IconeCheck className="alert__icone" />
              <span className="strong">Credencial “{estado.criada.nome}” criada. Copie agora, ela não aparece de novo.</span>
            </p>
          ) : null}
        </div>

        {estado.criada ? (
          <div className="alert alert--ok segredo">
            <code className="segredo__valor">{estado.criada.segredo}</code>
            <div className="acoes">
              <CopyButton texto={estado.criada.segredo} rotulo="Copiar credencial" className="btn btn--compacto" autoFoco />
            </div>
          </div>
        ) : null}
      </div>

      <form className="card__body" action={enviar}>
        <label className="field">
          <span className="field__label">Nome</span>
          <input
            className="input"
            type="text"
            name="nome"
            required
            maxLength={80}
            placeholder="Agente de estratégia"
            aria-describedby={estado.erro ? `${idDaDicaDoNome} ${idDoErro}` : idDaDicaDoNome}
          />
          <span id={idDaDicaDoNome} className="field__hint">
            Serve para reconhecer a credencial na lista e na auditoria.
          </span>
        </label>

        <fieldset className="grupo">
          <legend className="field__label">Ferramentas liberadas</legend>
          <div className="opcoes">
            {ferramentas.map((ferramenta) => (
              <label key={ferramenta} className="opcao">
                <input type="checkbox" name="ferramentas" value={ferramenta} defaultChecked />
                <span className="opcao__texto">
                  <span className="strong">{rotuloDaFerramenta(ferramenta)}</span>
                  <span className="opcao__id">{ferramenta}</span>
                </span>
              </label>
            ))}
          </div>
          <span className="field__hint">Só leitura. O agente não enxerga ferramenta que não esteja marcada.</span>
        </fieldset>

        <fieldset className="grupo grupo--alcance">
          <legend className="field__label">Alcance</legend>
          <div className="opcoes">
            <label className="opcao">
              <input type="radio" name="alcance" value="organizacao" defaultChecked />
              <span>Todos os {rotuloDosClientes} da organização</span>
            </label>
            <label className="opcao">
              <input type="radio" name="alcance" value="clientes" disabled={semClientes} />
              <span>Só os {rotuloDosClientes} que eu marcar</span>
            </label>
          </div>
          {semClientes ? <span className="field__hint">Ainda não há {rotuloDosClientes} cadastrados para restringir o alcance.</span> : null}
          <div className="opcoes alcance__clientes">
            {clientes.map((cliente) => (
              <label key={cliente.id} className="opcao">
                <input type="checkbox" name="clienteIds" value={cliente.id} />
                <span>{cliente.nome}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span className="field__label">Validade em dias</span>
          <input
            className="input"
            type="number"
            name="validadeEmDias"
            required
            min={1}
            max={validadeMaxima}
            defaultValue={validadePadrao}
            aria-describedby={idDaDicaDaValidade}
          />
          <span id={idDaDicaDaValidade} className="field__hint">
            No máximo {validadeMaxima} dias. Vencida, a credencial para de funcionar sozinha.
          </span>
        </label>

        <div className="acoes">
          <BotaoDeEnvio className="btn btn--primary" pendente="Criando…">
            Criar credencial
          </BotaoDeEnvio>
        </div>
      </form>
    </>
  );
}
