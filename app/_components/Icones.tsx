type Props = { readonly className?: string };

const BASE = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  focusable: false as const,
};

export function IconeClientes({ className }: Props) {
  return (
    <svg className={className} {...BASE}>
      <circle cx="7" cy="6.2" r="2.6" />
      <path d="M2 17c0-2.8 2.2-5 5-5s5 2.2 5 5" />
      <circle cx="14.3" cy="6.8" r="2" />
      <path d="M12.2 12.2c2.2.3 3.9 2.3 3.9 4.6" />
    </svg>
  );
}

export function IconeConexoes({ className }: Props) {
  return (
    <svg className={className} {...BASE}>
      <path d="M7.8 12.2a4 4 0 0 1 0-5.7l2-2a4 4 0 1 1 5.7 5.7l-1.1 1.1" />
      <path d="M12.2 7.8a4 4 0 0 1 0 5.7l-2 2a4 4 0 1 1-5.7-5.7l1.1-1.1" />
    </svg>
  );
}

export function IconeColetas({ className }: Props) {
  return (
    <svg className={className} {...BASE}>
      <path d="M3 13v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
      <path d="M10 3v8.5" />
      <path d="M6.5 8 10 11.5 13.5 8" />
    </svg>
  );
}

export function IconeAuditoria({ className }: Props) {
  return (
    <svg className={className} {...BASE}>
      <path d="M7 3.5h6a1 1 0 0 1 1 1V5h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1v-.5a1 1 0 0 1 1-1Z" />
      <path d="M7.5 10.3 9.3 12l3.2-3.6" />
    </svg>
  );
}

export function IconeCheck({ className }: Props) {
  return (
    <svg className={className} {...BASE}>
      <circle cx="10" cy="10" r="7.2" />
      <path d="m6.8 10.2 2.2 2.2 4.2-4.6" />
    </svg>
  );
}

export function IconeRelogio({ className }: Props) {
  return (
    <svg className={className} {...BASE}>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M10 5.8V10l2.8 1.8" />
    </svg>
  );
}

export function IconeBloqueio({ className }: Props) {
  return (
    <svg className={className} {...BASE}>
      <circle cx="10" cy="10" r="7.2" />
      <path d="m5 5 10 10" />
    </svg>
  );
}

export function IconeAlerta({ className }: Props) {
  return (
    <svg className={className} {...BASE}>
      <path d="M10 3.2 17.4 16H2.6L10 3.2Z" />
      <path d="M10 8.2v3.6" />
      <path d="M10 14.1h.01" />
    </svg>
  );
}

export function IconePausa({ className }: Props) {
  return (
    <svg className={className} {...BASE}>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M8.2 7.6v4.8M11.8 7.6v4.8" />
    </svg>
  );
}
