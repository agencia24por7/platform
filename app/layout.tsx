import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Bricolage_Grotesque, Inter, Sora } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { CABECALHO_DO_NONCE } from '@/shared/http/csp';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});

const sora = Sora({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-sora',
  display: 'swap',
});

const DESCRICAO = 'Um oceano azul para seus anúncios.';

function enderecoPublico(): URL | undefined {
  const bruto = process.env['TRIA_APP_BASE_URL'];
  if (!bruto) return undefined;

  try {
    return new URL(bruto);
  } catch {
    return undefined;
  }
}

export function generateMetadata(): Metadata {
  const base = enderecoPublico();

  return {
    metadataBase: base,
    title: { default: 'Orla - Ads Platform', template: '%s · Orla - Ads Platform' },
    description: DESCRICAO,
    robots: { index: false, follow: false },
    openGraph: {
      title: 'Orla - Ads Platform',
      description: DESCRICAO,
      url: base,
      siteName: 'Orla - Ads Platform',
      locale: 'pt_BR',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Orla - Ads Platform',
      description: DESCRICAO,
    },
  };
}

const THEME_SCRIPT = `(function () {
  try {
    if (localStorage.getItem('orla-tema') === 'grafite') {
      document.documentElement.setAttribute('data-tema', 'grafite');
    }
  } catch (_) {}
})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get(CABECALHO_DO_NONCE) ?? undefined;

  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${bricolage.variable} ${sora.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
