import type { Metadata } from 'next';
import { Bricolage_Grotesque, Inter, Sora } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

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
const ENDERECO_PADRAO = 'http://localhost:3000';

function enderecoPublico(): URL {
  try {
    return new URL(process.env['TRIA_APP_BASE_URL'] ?? ENDERECO_PADRAO);
  } catch {
    return new URL(ENDERECO_PADRAO);
  }
}

export function generateMetadata(): Metadata {
  const base = enderecoPublico();

  return {
    metadataBase: base,
    title: { default: 'orla', template: '%s · orla' },
    description: DESCRICAO,
    robots: { index: false, follow: false },
    openGraph: {
      title: 'orla',
      description: DESCRICAO,
      url: base,
      siteName: 'orla',
      locale: 'pt_BR',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'orla',
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${bricolage.variable} ${sora.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
