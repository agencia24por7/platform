import type { ReactNode } from 'react';

export type WizardStep = { readonly key: string; readonly label: string; readonly hint: string };

export const WIZARD_STEPS: readonly WizardStep[] = [
  { key: 'conectar', label: 'Conectar contas', hint: 'Autorize a primeira plataforma' },
  { key: 'operacao', label: 'Sua operação', hint: 'Quem opera o quê' },
  { key: 'contas', label: 'Selecionar contas', hint: 'Escolha o que entra na plataforma' },
];

type Props = { readonly current: string; readonly children: ReactNode };

export function Wizard({ current, children }: Props) {
  const index = WIZARD_STEPS.findIndex((step) => step.key === current);

  return (
    <div className="wizard">
      <aside className="wizard__rail">
        <div className="wizard__brand">
          <span className="mark">T</span>
          tria
        </div>

        <div>
          <div className="wizard__title">
            Vamos preparar
            <br />
            sua operação
          </div>
          <div className="wizard__lead">
            Três passos curtos. Você autoriza as contas pelos canais oficiais e revoga quando quiser.
          </div>
        </div>

        <div className="wizard__steps">
          {WIZARD_STEPS.map((step, position) => (
            <div
              key={step.key}
              className={`wstep ${position === index ? 'wstep--active' : ''} ${position < index ? 'wstep--done' : ''}`}
            >
              <span className="wstep__n">{position < index ? '✓' : position + 1}</span>
              <span>
                <span className="wstep__label">{step.label}</span>
                <span className="wstep__hint">{step.hint}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="wizard__foot">
          Nenhum segredo é digitado aqui. O token fica no cofre do n8n e o acesso é revogável a qualquer
          momento.
        </div>
      </aside>

      <main className="wizard__main">
        <div className="wizard__panel">{children}</div>
      </main>
    </div>
  );
}
