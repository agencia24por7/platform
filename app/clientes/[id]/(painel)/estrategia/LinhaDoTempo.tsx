import Link from 'next/link';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { TilPensando } from '@/../app/_components/Til';
import { AtualizacaoPeriodica } from '@/../app/clientes/[id]/(painel)/estrategia/AtualizacaoPeriodica';
import type { ExecucaoNaTela } from '@/modules/strategy/interface/visaoDoPlano';

const ICONE_DA_ETAPA = { feita: 'ok', atual: 'reautorizar', pendente: 'vazio' } as const;
const TEXTO_DA_ETAPA = { feita: ' (concluída)', atual: ' (em andamento)', pendente: ' (a fazer)' } as const;

export function LinhaDoTempo({ execucao, atualizarEm }: { readonly execucao: ExecucaoNaTela; readonly atualizarEm: string }) {
  return (
    <section className="card" aria-label="Andamento do plano">
      <AtualizacaoPeriodica ativa={!execucao.parada} />
      <div className="card__body">
        {execucao.parada ? (
          <p className="card__title">{execucao.titulo}</p>
        ) : (
          <div className="andamento">
            <TilPensando className="til--grande" decorativo />
            <div className="andamento__textos">
              <p className="card__title">{execucao.titulo}</p>
              <p className="andamento__etapa" role="status" aria-live="polite" aria-atomic="true">
                {execucao.etapaAtual}
              </p>
            </div>
          </div>
        )}
        <ol className="etapas">
          {execucao.etapas.map((etapa) => (
            <li key={etapa.chave} className={`etapas__item etapas__item--${etapa.estado}`} aria-current={etapa.estado === 'atual' ? 'step' : undefined}>
              {etapa.estado === 'atual' && !execucao.parada ? <TilPensando className="til--etapa" decorativo /> : <Icone nome={ICONE_DA_ETAPA[etapa.estado]} tamanho={14} />}
              <span>{etapa.rotulo}</span>
              <span className="sr-only">{TEXTO_DA_ETAPA[etapa.estado]}</span>
            </li>
          ))}
        </ol>
        <p className="field__hint">
          A tela se atualiza sozinha. <Link href={atualizarEm}>Atualizar agora</Link>
        </p>
      </div>
    </section>
  );
}
