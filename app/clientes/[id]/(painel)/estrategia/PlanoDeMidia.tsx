import { Marcas } from '@/../app/clientes/[id]/(painel)/estrategia/BlocosDaSecao';
import type { PlataformaDeMidiaNaTela } from '@/modules/strategy/interface/visaoDoPlano';

export function PlanoDeMidia({ plataformas }: { readonly plataformas: readonly PlataformaDeMidiaNaTela[] }) {
  if (plataformas.length === 0) return <p className="subtle">Nada informado no plano de mídia.</p>;
  return (
    <div className="pilha">
      {plataformas.map((plataforma) => (
        <details key={plataforma.plataforma} className="midia-plataforma" open={plataforma.aberta}>
          <summary className="midia-plataforma__titulo">{plataforma.rotulo}</summary>
          {plataforma.link ? (
            <p className="field__hint midia-plataforma__link">
              Link com UTM: <code>{plataforma.link}</code>
            </p>
          ) : null}
          {plataforma.secoes.map((secao) => (
            <details key={secao.chave} className="midia-secao" open={secao.aberta}>
              <summary className="midia-secao__titulo">{secao.titulo}</summary>
              <dl className="midia-campos">
                {secao.campos.map((campo) => (
                  <div key={campo.chave} className="midia-campo">
                    <dt>{campo.rotulo}</dt>
                    <dd>
                      <span>{campo.valor}</span>
                      {campo.justificativa ? <span className="midia-campo__porque">Por quê: {campo.justificativa}</span> : null}
                      <Marcas marcas={campo.marcas} />
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </details>
      ))}
    </div>
  );
}
