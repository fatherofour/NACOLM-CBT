import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// Archivo (SIL Open Font License), self-hosted so the portal needs no call
// to Google Fonts: variable weight 100–900 and width 62–125.
const archivo = localFont({
  src: './fonts/archivo-latin-wdth-normal.woff2',
  variable: '--font-archivo',
  weight: '100 900',
  display: 'swap',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
});

export const metadata: Metadata = {
  title: { default: 'NACOLM CBT', template: '%s | NACOLM CBT' },
  description: 'Question setter for the Nigerian Army College of Logistics and Management',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0f3b22', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
