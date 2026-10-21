import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const metadata = { title: 'ใบรับรองแทนใบเสร็จรับเงิน' };

export default function RootLayout({ children }) {
  const html = readFileSync(join(process.cwd(), 'public/index.html'), 'utf8');
  const theme = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: theme }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <link rel="stylesheet" href="/retro.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
