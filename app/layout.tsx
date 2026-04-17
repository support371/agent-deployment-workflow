import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'GEM Agent Builder',
  description: 'Instruction → sandbox build → test → deploy. Real-time.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Syne:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans bg-bg-base text-fg-primary antialiased">
        {children}
      </body>
    </html>
  );
}
