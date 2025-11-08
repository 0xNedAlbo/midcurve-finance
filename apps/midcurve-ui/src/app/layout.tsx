import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Web3Provider } from '@/providers/web3-provider';
import { QueryProvider } from '@/providers/query-provider';
import { SessionProvider } from 'next-auth/react';
import { Erc20TransferEventProvider } from '@/lib/events/erc20-transfer-event-context';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Midcurve Finance',
  description: 'Professional risk management for concentrated liquidity providers',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SessionProvider>
          <QueryProvider>
            <Web3Provider>
              <Erc20TransferEventProvider>
                {children}
              </Erc20TransferEventProvider>
            </Web3Provider>
          </QueryProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
