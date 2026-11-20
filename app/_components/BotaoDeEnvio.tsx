'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export function BotaoDeEnvio({
  children,
  pendente,
  className,
  title,
}: {
  readonly children: ReactNode;
  readonly pendente: string;
  readonly className: string;
  readonly title?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" title={title} disabled={pending} aria-busy={pending}>
      {pending ? pendente : children}
    </button>
  );
}
