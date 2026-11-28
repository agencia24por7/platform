'use client';

import { useActionState, useId } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { editarSecaoAcao, type EstadoDoFormulario } from '@/../app/clientes/[id]/(painel)/estrategia/acoes';
import type { CampoEditavel, GrupoDeCampos } from '@/modules/strategy/interface/camposEditaveisDaSecao';

const ESTADO_INICIAL: EstadoDoFormulario = {};

type Props = {
  readonly clienteId: string;
  readonly planoId: string;
  readonly versaoId: string;
  readonly secao: string;
  readonly titulo: string;
  readonly grupos: readonly GrupoDeCampos[];
  readonly habilitada: boolean;
  readonly motivo: string | null;
};

type CampoProps = { readonly id: string; readonly campo: CampoEditavel; readonly valor: string; readonly erro: string | undefined };

function Entrada({ id, campo, valor, erro }: CampoProps) {
  const nome = `campo:${campo.caminho}`;
  const ligacao = {
    id,
    name: nome,
    'aria-invalid': erro ? true : undefined,
    'aria-describedby': [campo.dica ? `${id}-dica` : null, erro ? `${id}-erro` : null].filter((item) => item !== null).join(' ') || undefined,
  };
  if (campo.tipo === 'escolha') {
    return (
      <select className="select" defaultValue={valor} {...ligacao}>
        {campo.opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.rotulo}
          </option>
        ))}
      </select>
    );
  }
  if (campo.tipo === 'texto_longo') {
    return <textarea className="input textarea" defaultValue={valor} rows={4} maxLength={campo.maximo ?? undefined} {...ligacao} />;
  }
  if (campo.tipo === 'numero') {
    return <input className="input" type="number" step="any" defaultValue={valor} {...ligacao} />;
  }
  if (campo.tipo === 'dinheiro') {
    return <input className="input" type="text" inputMode="decimal" autoComplete="off" defaultValue={valor} {...ligacao} />;
  }
  return <input className="input" type="text" defaultValue={valor} maxLength={campo.maximo ?? undefined} {...ligacao} />;
}

export function EditorDeSecao({ clienteId, planoId, versaoId, secao, titulo, grupos, habilitada, motivo }: Props) {
  const base = useId();
  const [estado, enviar] = useActionState(editarSecaoAcao, ESTADO_INICIAL);

  if (!habilitada) {
    return (
      <button type="button" className="btn btn--compacto" disabled title={motivo ?? undefined} aria-label={`Editar a seção ${titulo} (indisponível)`}>
        Editar seção
      </button>
    );
  }

  return (
    <details className="editor-secao" open={estado.erro ? true : undefined}>
      <summary className="btn btn--compacto" aria-label={`Editar a seção ${titulo}`}>
        Editar seção
      </summary>
      <form className="estrategia-form" action={enviar}>
        <input type="hidden" name="clienteId" value={clienteId} />
        <input type="hidden" name="planoId" value={planoId} />
        <input type="hidden" name="versaoId" value={versaoId} />
        <input type="hidden" name="secao" value={secao} />
        <p className="aviso">
          <Icone nome="atencao" tamanho={14} /> Toda mudança cria uma versão nova, que passa por revisão de novo.
        </p>
        {estado.erro ? (
          <div className="alert alert--error" role="alert" id={`${base}-erros`} tabIndex={-1}>
            <Icone nome="erro" />
            <p>{estado.erro}</p>
          </div>
        ) : null}
        {grupos.map((grupo) => (
          <fieldset key={grupo.chave} className="estrategia-form__grupo">
            <legend className="field__label">{grupo.titulo}</legend>
            {grupo.campos.map((campo) => {
              const id = `${base}-${campo.caminho}`;
              const erro = estado.campos?.[campo.caminho];
              return (
                <div className="field" key={campo.caminho}>
                  <label className="field__label" htmlFor={id}>
                    {campo.rotulo}
                  </label>
                  <Entrada id={id} campo={campo} valor={estado.valores?.[`campo:${campo.caminho}`] ?? campo.valor} erro={erro} />
                  {campo.dica ? (
                    <span className="field__hint" id={`${id}-dica`}>
                      {campo.dica}
                    </span>
                  ) : null}
                  {erro ? (
                    <span className="field__erro" id={`${id}-erro`} role="alert">
                      <Icone nome="erro" tamanho={14} /> {erro}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
        ))}
        <BotaoDeEnvio className="btn btn--primary" pendente="Salvando…">
          Salvar alterações
        </BotaoDeEnvio>
      </form>
    </details>
  );
}
