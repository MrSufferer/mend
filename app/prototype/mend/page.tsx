import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Prototype from './prototype';
// Throwaway UI exploration: three structurally different layouts at ?variant=A|B|C.
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Suspense fallback={<main className="boot">Loading Mend prototype…</main>}><Prototype /></Suspense>;
}
