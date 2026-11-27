import type { ReactNode } from 'react';
import { EditorDeSecao } from '@/../app/clientes/[id]/(painel)/estrategia/EditorDeSecao';
import type { AcaoDaVisao, BlocoDoPlano as Bloco } from '@/modules/strategy/interface/visaoDoPlano';

type Props = {
  readonly clienteId: string;
  readonly planoId: string;
  readonly versaoId: string;
  readonly bloco: Bloco<unknown>;
  readonly edicao: AcaoDaVisao | undefined;
  readonly children: ReactNode;
};

export function BlocoDoPlano({ clienteId, planoId, versaoId, bloco, edicao, children }: Props) {
  const idDoTitulo = `titulo-${bloco.chave}`;
  return (
    <section className="card estrategia-bloco" aria-labelledby={idDoTitulo}>
      <div className="card__head">
        <h3 className="card__title" id={idDoTitulo}>
          {bloco.titulo}
        </h3>
        {edicao ? (
          <EditorDeSecao
            clienteId={clienteId}
            planoId={planoId}
            versaoId={versaoId}
            secao={bloco.chave}
            titulo={bloco.titulo}
            grupos={bloco.grupos}
            habilitada={edicao.habilitada}
            motivo={edicao.motivos[0] ?? null}
          />
        ) : null}
      </div>
      <div className="card__body">{children}</div>
    </section>
  );
}
