'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export function BotaoDeEnvio({
  children,
  pendente,
  className,
  title,
  ariaLabel,
}: {
  readonly children: ReactNode;
  readonly pendente: string;
  readonly className: string;
  readonly title?: string;
  readonly ariaLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" title={title} aria-label={ariaLabel} disabled={pending} aria-busy={pending}>
      {pending ? pendente : children}
    </button>
  );
}
