import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Script from 'next/script';

export default function ReceiptPage() {
  const html = readFileSync(join(process.cwd(), 'public/index.html'), 'utf8');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  const markup = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const runtime = body.match(/<script>([\s\S]*?)<\/script>/)[1];
  const baht = readFileSync(join(process.cwd(), 'public/baht.js'), 'utf8');
  // Keep the existing DOM controller isolated from React while preserving print and form behavior.
  return <>
    <div dangerouslySetInnerHTML={{ __html: markup }} />
    <Script id="receipt-runtime" strategy="afterInteractive">{baht + '\n' + runtime}</Script>
  </>;
}
