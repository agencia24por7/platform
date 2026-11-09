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

export const metadata: Metadata = {
  title: 'orla',
  description: 'Um oceano azul para seus anúncios.',
  robots: { index: false, follow: false },
  icons: { icon: '/orla/icone.png' },
};

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
