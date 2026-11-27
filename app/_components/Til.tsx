const ONDA = 'M-160 40 C-110 -50 -40 -60 5 0 S120 65 160 -40';
const VIEWBOX = '-215 -110 430 220';

export function TilIcone({ className }: { readonly className?: string }) {
  const comPonto = className?.includes('til--claro') ?? false;
  return (
    <span className={`til ${className ?? ''}`} aria-hidden="true">
      <svg viewBox={VIEWBOX} focusable="false">
        <path d={ONDA} />
        {comPonto ? <circle cx="0" cy="95" r="22" fill="currentColor" stroke="none" /> : null}
      </svg>
    </span>
  );
}

export function TilPensando({ className, decorativo = false }: { readonly className?: string; readonly decorativo?: boolean }) {
  const acessibilidade = decorativo ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': 'Agente pensando' };
  return (
    <span className={`til til--pensando ${className ?? ''}`} {...acessibilidade}>
      <svg viewBox={VIEWBOX} focusable="false">
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
      <svg viewBox={VIEWBOX} focusable="false">
        <path d={ONDA} />
      </svg>
    </span>
  );
}

export function TilVazio() {
  return (
    <span className="til til--vazio" aria-hidden="true">
      <svg viewBox={VIEWBOX} focusable="false">
        <path d={ONDA} />
      </svg>
    </span>
  );
}
