type Props = {
  readonly valor: number;
  readonly rotulo: string;
  readonly tamanho?: number;
  readonly espessura?: number;
  readonly tom?: 'acento' | 'ok' | 'alerta';
  readonly detalhe?: string;
};

export function Anel({ valor, rotulo, tamanho = 64, espessura = 7, tom = 'acento', detalhe }: Props) {
  const seguro = Math.min(Math.max(Math.round(valor), 0), 100);
  const raio = (tamanho - espessura) / 2;
  const circunferencia = 2 * Math.PI * raio;
  const preenchido = (seguro / 100) * circunferencia;

  return (
    <figure className={`anel anel--${tom}`} aria-label={`${rotulo}: ${seguro}%${detalhe ? `, ${detalhe}` : ''}`} role="img">
      <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} aria-hidden="true">
        <circle className="anel__trilho" cx={tamanho / 2} cy={tamanho / 2} r={raio} strokeWidth={espessura} fill="none" />
        {seguro > 0 ? (
        <circle
          className="anel__valor"
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          strokeWidth={espessura}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${preenchido} ${circunferencia}`}
          transform={`rotate(-90 ${tamanho / 2} ${tamanho / 2})`}
        />
        ) : null}
        <text className="anel__numero" x="50%" y="50%" dominantBaseline="central" textAnchor="middle">
          {seguro}
          <tspan className="anel__pct">%</tspan>
        </text>
      </svg>
      <figcaption className="anel__rotulo">
        {rotulo}
        {detalhe ? <span className="anel__detalhe">{detalhe}</span> : null}
      </figcaption>
    </figure>
  );
}

export function Barra({ valor, rotulo, tom = 'acento' }: { readonly valor: number; readonly rotulo: string; readonly tom?: 'acento' | 'suave' | 'ok' }) {
  const seguro = Math.min(Math.max(Math.round(valor), 0), 100);
  return (
    <svg className={`barra barra--${tom}`} viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label={`${rotulo}: ${seguro}%`}>
      <rect className="barra__trilho" x="0" y="0" width="100" height="6" rx="3" />
      {seguro > 0 ? <rect className="barra__valor" x="0" y="0" width={seguro} height="6" rx="3" /> : null}
    </svg>
  );
}
