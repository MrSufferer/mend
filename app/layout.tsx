import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import IsolatedProviders from './prototype/components/isolated-providers';
const sans = Geist({ subsets: ['latin'], variable: '--font-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });
export const metadata: Metadata = { title: 'Mend · Private orders', description: 'Wallet-authenticated documents and recovery for Arc testnet orders.', robots: { index: false, follow: false }, icons: { icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="%230b706f"/><text x="6" y="24" fill="white" font-size="26">m</text></svg>' } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${sans.variable} ${mono.variable}`}><body><IsolatedProviders>{children}</IsolatedProviders></body></html>;
}
