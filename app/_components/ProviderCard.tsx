import Link from 'next/link';

type Props = {
  readonly platform: 'google' | 'meta';
  readonly available: boolean;
  readonly authorized: boolean;
};

const MARCAS = {
  google: { arquivo: '/marcas/google-ads.png', nome: 'Google Ads' },
  meta: { arquivo: '/marcas/meta.png', nome: 'Meta Ads' },
} as const;

export function ProviderCard({ platform, available, authorized }: Props) {
  const marca = MARCAS[platform];

  return (
    <div className="provider">
      <span className="provider__logo">
        <img src={marca.arquivo} alt="" width={40} height={40} decoding="async" />
      </span>
      <span className="provider__name">{marca.nome}</span>

      {authorized ? (
        <>
          <span className="pill pill--ok">
            <span className="dot" />
            Autorizado
          </span>
          <Link className="btn btn--pill" href="/comecar?passo=operacao">
            Continuar
          </Link>
        </>
      ) : (
        <>
          <Link
            className="btn btn--primary btn--pill"
            href={`/api/oauth/${platform}/start?returnTo=${encodeURIComponent('/comecar?passo=conectar')}`}
          >
            Conectar →
          </Link>
          <span className="provider__state">
            {available ? 'Abre o consentimento oficial' : 'Aplicativo ainda não aprovado'}
          </span>
        </>
      )}
    </div>
  );
}
