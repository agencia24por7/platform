import Link from 'next/link';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { AtualizacaoPeriodica } from '@/../app/clientes/[id]/(painel)/estrategia/AtualizacaoPeriodica';
import type { ExecucaoNaTela } from '@/modules/strategy/interface/visaoDoPlano';

const ICONE_DA_ETAPA = { feita: 'ok', atual: 'reautorizar', pendente: 'vazio' } as const;
const TEXTO_DA_ETAPA = { feita: ' (concluída)', atual: ' (em andamento)', pendente: ' (a fazer)' } as const;

export function LinhaDoTempo({ execucao, atualizarEm }: { readonly execucao: ExecucaoNaTela; readonly atualizarEm: string }) {
  return (
    <section className="card" aria-label="Andamento do plano">
      <AtualizacaoPeriodica ativa={!execucao.parada} />
      <div className="card__body">
        <p className="card__title">{execucao.titulo}</p>
        <ol className="etapas">
          {execucao.etapas.map((etapa) => (
            <li key={etapa.chave} className={`etapas__item etapas__item--${etapa.estado}`} aria-current={etapa.estado === 'atual' ? 'step' : undefined}>
              <Icone nome={ICONE_DA_ETAPA[etapa.estado]} tamanho={14} />
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
