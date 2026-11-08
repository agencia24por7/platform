const ONDA = 'M2 9 C6 3 10 15 14 9 C18 3 22 15 26 9';

export function TilIcone({ className }: { readonly className?: string }) {
  const comPonto = className?.includes('til--claro') ?? false;
  return (
    <span className={`til ${className ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 28 18" focusable="false">
        <path d={ONDA} />
        {comPonto ? <circle cx="14" cy="15" r="1.6" fill="currentColor" stroke="none" /> : null}
      </svg>
    </span>
  );
}

export function TilPensando({ className }: { readonly className?: string }) {
  return (
    <span className={`til til--pensando ${className ?? ''}`} role="img" aria-label="Agente pensando">
      <svg viewBox="0 0 28 18" focusable="false">
        <path d={ONDA} opacity="0.3" />
        <path className="til__traco" d={ONDA} />
      </svg>
    </span>
  );
}

export function TilCarregando({ label = 'Carregando' }: { readonly label?: string }) {
  return (
    <span className="til--carregando" role="img" aria-label={label}>
      {[0, 1, 2, 3].map((item) => (
        <TilIcone key={item} />
      ))}
    </span>
  );
}

export function TilOportunidade() {
  return (
    <span className="til til--oportunidade" aria-hidden="true">
      <svg viewBox="0 0 28 18" focusable="false">
        <path d={ONDA} />
      </svg>
    </span>
  );
}

export function TilVazio() {
  return (
    <span className="til til--vazio" aria-hidden="true">
      <svg viewBox="0 0 28 18" focusable="false">
        <path d={ONDA} />
      </svg>
    </span>
  );
}
