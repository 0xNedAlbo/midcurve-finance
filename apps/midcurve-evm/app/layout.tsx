/**
 * Root Layout for midcurve-evm API
 *
 * This is a headless API - no UI rendering.
 */

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
