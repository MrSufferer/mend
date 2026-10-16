'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { WalletProviders } from '../../../lib/client/wallet';
// Throwaway purchase prototype never mounts live auth, wallet or query providers.
export default function IsolatedProviders({children}:{children:ReactNode}) {
  const pathname=usePathname();
  return pathname.startsWith('/prototype/purchase')?<>{children}</>:<WalletProviders>{children}</WalletProviders>;
}
