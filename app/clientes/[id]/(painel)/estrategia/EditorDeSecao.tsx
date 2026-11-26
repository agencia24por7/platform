'use client';

import { useActionState, useId } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { editarSecaoAcao, type EstadoDoFormulario } from '@/../app/clientes/[id]/(painel)/estrategia/acoes';
import { caminhoLegivel } from '@/modules/strategy/interface/visaoDoPlano';

const ESTADO_INICIAL: EstadoDoFormulario = {};

type Props = {
  readonly clienteId: string;
  readonly planoId: string;
  readonly versaoId: string;
  readonly secao: string;
  readonly titulo: string;
  readonly json: string;
  readonly habilitada: boolean;
  readonly motivo: string | null;
};

export function EditorDeSecao({ clienteId, planoId, versaoId, secao, titulo, json, habilitada, motivo }: Props) {
  const base = useId();
  const [estado, enviar] = useActionState(editarSecaoAcao, ESTADO_INICIAL);
  const problemas = Object.entries(estado.campos ?? {});
  const erroDeJson = estado.campos?.['json'];
  const problemasDoEsquema = problemas.filter(([caminho]) => caminho !== 'json');

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
          <Icone nome="atencao" tamanho={14} /> Edição avançada: você altera o conteúdo bruto (JSON) desta seção. Toda mudança cria uma versão nova e volta ao Comitê e aos Gates.
        </p>
        <div className="field">
          <label className="field__label" htmlFor={`${base}-json`}>
            Conteúdo da seção {titulo}
          </label>
          <textarea
            id={`${base}-json`}
            className="input textarea editor-secao__json"
            name="json"
            defaultValue={estado.valores?.['json'] ?? json}
            rows={14}
            spellCheck={false}
            required
            aria-invalid={estado.erro ? true : undefined}
            aria-describedby={estado.erro ? `${base}-erros` : undefined}
          />
        </div>
        {estado.erro ? (
          <div className="alert alert--error" role="alert" id={`${base}-erros`} tabIndex={-1}>
            <Icone nome="erro" />
            <div>
              <p>{estado.erro}</p>
              {erroDeJson ? <p>{erroDeJson}</p> : null}
              {problemasDoEsquema.length > 0 ? (
                <ul className="editor-secao__problemas">
                  {problemasDoEsquema.map(([caminho, mensagem]) => (
                    <li key={caminho}>
                      <strong>{caminhoLegivel(caminho)}:</strong> {mensagem}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
        <BotaoDeEnvio className="btn btn--primary" pendente="Salvando…">
          Salvar e enviar ao Comitê
        </BotaoDeEnvio>
      </form>
    </details>
  );
}
