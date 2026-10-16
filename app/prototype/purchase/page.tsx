import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import PurchasePrototype from './purchase-prototype';
import './purchase.css';
// Three throwaway browser-purchase variants in the existing My orders context.
// Isolated route keeps the real /orders and /recovery pages untouched.
export default function Page(){
  if(process.env.NODE_ENV==='production')notFound();
  return <Suspense fallback={<main className="boot">Loading purchase exploration…</main>}><PurchasePrototype/></Suspense>;
}
