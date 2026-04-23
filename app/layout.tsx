import type { Metadata, Viewport } from 'next';
import { Playfair_Display, Jost } from 'next/font/google';
import './globals.css';

const display = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  style: ['normal', 'italic'],
  weight: ['400', '500', '700'],
});

const sans = Jost({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['300', '400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Wardrobe',
  description: 'A curated closet, in pink.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Wardrobe',
  },
};

export const viewport: Viewport = {
  themeColor: '#fef5f5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
