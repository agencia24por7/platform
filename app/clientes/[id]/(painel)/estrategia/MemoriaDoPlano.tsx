import type { ReactNode } from 'react';
import {
  ROTULO_DO_BOTAO_DA_MEMORIA,
  TITULO_DA_MEMORIA,
  type FonteCitada,
  type MemoriaDoPlano as Memoria,
} from '@/modules/strategy/interface/memoriaDoPlano';
import { TEXTO_DE_SEM_REGISTRO } from '@/modules/strategy/interface/memoriaEmMarkdown';

function Grupo({ titulo, children }: { readonly titulo: string; readonly children: ReactNode }) {
  return (
    <div className="pilha">
      <h4 className="card__title">{titulo}</h4>
      {children}
    </div>
  );
}

function Itens({ itens }: { readonly itens: readonly ReactNode[] }) {
  if (itens.length === 0) return <p className="field__hint">{TEXTO_DE_SEM_REGISTRO}</p>;
  return (
    <ul>
      {itens.map((item, indice) => (
        <li key={indice}>{item}</li>
      ))}
    </ul>
  );
}

const textoDaFonte = (fonte: FonteCitada) => `${fonte.titulo} (${fonte.papel}${fonte.nota ? `, nota ${fonte.nota}` : ''})`;

export function MemoriaDoPlano({ memoria, href }: { readonly memoria: Memoria; readonly href: string }) {
  return (
    <section className="card" aria-labelledby="titulo-memoria-do-plano" data-memoria-do-plano>
      <div className="card__head">
        <h3 className="card__title" id="titulo-memoria-do-plano">
          {TITULO_DA_MEMORIA}
        </h3>
        <a className="btn" href={href} download={memoria.nomeDoArquivo}>
          {ROTULO_DO_BOTAO_DA_MEMORIA}
        </a>
      </div>
      <div className="card__body pilha">
        <Grupo titulo="Versões">
          {memoria.versoesParciais ? <p className="field__hint">Mostra só as versões mais recentes.</p> : null}
          <Itens
            itens={memoria.versoes.map((versao) => (
              <span key={versao.id}>
                <strong>{versao.rotulo}</strong>, <time>{versao.quando}</time>: {versao.tipo}, por {versao.autor}. Estado: {versao.status}.
                {versao.marcos.length > 0 ? ` ${versao.marcos.join('; ')}.` : ''}
              </span>
            ))}
          />
        </Grupo>
        <Grupo titulo="Intenção e foco">
          {memoria.intencao ? (
            <Itens
              itens={[
                `Objetivo: ${memoria.intencao.objetivo}`,
                `Foco: ${memoria.intencao.foco ?? 'não informado'}`,
                `Período: ${memoria.intencao.horizonte}`,
                `Verba: ${memoria.intencao.verba}`,
                `Ousadia: ${memoria.intencao.ousadia}`,
                `Plataformas: ${memoria.intencao.plataformas.length === 0 ? 'não informadas' : memoria.intencao.plataformas.join(', ')}`,
              ]}
            />
          ) : (
            <p className="field__hint">{TEXTO_DE_SEM_REGISTRO}</p>
          )}
        </Grupo>
        <Grupo titulo="Decisões criativas">
          {memoria.decisoes.length === 0 ? <p className="field__hint">{TEXTO_DE_SEM_REGISTRO}</p> : null}
          {memoria.decisoes.map((grupo) => (
            <div key={`${grupo.versao}-${grupo.quando}`} className="pilha">
              <p className="field__hint">
                {grupo.versao}, {grupo.quando}
              </p>
              <Itens
                itens={grupo.itens.map((item) => (
                  <span key={`${item.tema}-${item.autor}-${item.motivo}`}>
                    <strong>{item.tema}</strong>, {item.autor}: {item.decisao}. Motivo: {item.motivo}
                  </span>
                ))}
              />
            </div>
          ))}
        </Grupo>
        <Grupo titulo="Sinais de cultura">
          <Itens itens={memoria.cultura.map(textoDaFonte)} />
        </Grupo>
        <Grupo titulo="Evidências citadas">
          <Itens itens={memoria.evidencias.map(textoDaFonte)} />
        </Grupo>
        <Grupo titulo="Créditos">
          <Itens
            itens={[
              `Pessoas: ${memoria.creditos.pessoas.length === 0 ? 'sem registro' : memoria.creditos.pessoas.join('; ')}`,
              `Comitês convocados: ${memoria.creditos.comites.length === 0 ? 'sem registro' : memoria.creditos.comites.join('; ')}`,
            ]}
          />
        </Grupo>
        <Grupo titulo="Resultados">
          <Itens itens={memoria.resultados} />
        </Grupo>
      </div>
    </section>
  );
}
