import type { Metadata } from 'next';
import { Bricolage_Grotesque, Inter } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'orla',
  description: 'Um oceano azul para seus anúncios.',
  robots: { index: false, follow: false },
};

const THEME_SCRIPT = `(function () {
  try {
    var salvo = localStorage.getItem('orla-tema');
    if (salvo === 'claro' || salvo === 'grafite') {
      document.documentElement.setAttribute('data-tema', salvo);
    }
  } catch (_) {}
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${bricolage.variable}`}>
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
