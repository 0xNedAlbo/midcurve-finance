import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Midcurve Signer API',
  description: 'Internal signing service for Midcurve Finance automation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
