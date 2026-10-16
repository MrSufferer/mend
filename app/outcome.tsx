'use client';

import { ArrowRight, Check, FileText, Link2, X } from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import s from './outcome.module.css';

function Story({ onEvidence }: { onEvidence: () => void }) {
  return <section className={s.outcome} aria-labelledby="outcome-title">
    <div className={s.pitch}>
      <p className={s.kicker}>RECOVERY FOR API BUSINESSES</p>
      <h1 id="outcome-title">The customer paid.<br />The result went missing.<br /><span>Mend closes the loop.</span></h1>
      <p className={s.lead}>Mend resolves failed paid jobs for API businesses. It checks the evidence, recovers what it can, and escalates what it can’t.</p>
      <button className={s.primary} onClick={onEvidence}>See a recovery <ArrowRight size={16} aria-hidden="true" /></button>
      <p className={s.quiet}>PDF-to-text is the working service. Recovery is the business.</p>
    </div>
    <article className={s.receipt} aria-label="Sample recovered order">
      <div className={s.receiptTop}><span className={s.kicker}>SAMPLE RECOVERY</span><span className={s.status}><Check size={13} aria-hidden="true" /> Access restored</span></div>
      <div className={s.file}><FileText size={26} aria-hidden="true" /><div><h2>report.pdf</h2><p>PDF → plain text · Sample order</p></div></div>
      <ol className={s.steps}>
        <li><span>01</span><div><strong>Payment confirmed</strong><p>The job was paid for. Its download link was missing.</p></div></li>
        <li><span>02</span><div><strong>Existing result found</strong><p>Mend checked the job and found the completed text.</p></div></li>
        <li><span><Check size={15} aria-hidden="true" /></span><div><strong>Access restored</strong><p>The customer can get the original result.</p></div></li>
      </ol>
      <div className={s.result}><Link2 size={18} aria-hidden="true" /><div><strong>Same job. Result available.</strong><p>No second charge. No refund needed in this sample.</p></div></div>
      <button className={s.textAction} onClick={onEvidence}>Inspect the sample evidence <ArrowRight size={15} aria-hidden="true" /></button>
      <p className={s.disclaimer}>Illustrative records, not a live customer incident. Access restored does not prove a download.</p>
    </article>
  </section>;
}

function Evidence({ close, opener }: { close: () => void; opener: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const dismiss = () => { dialog.current?.close(); close(); requestAnimationFrame(() => opener?.focus()); };
  return <dialog ref={dialog} className={s.dialog} aria-labelledby="evidence-title" onCancel={event => { event.preventDefault(); dismiss(); }} onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <div className={s.dialogHeading}><p className={s.kicker}>SAMPLE EVIDENCE · NOT LIVE</p><button className={s.icon} onClick={dismiss} aria-label="Close evidence"><X size={20} /></button></div>
    <h2 id="evidence-title">How access was restored</h2>
    <p className={s.subheading}>One illustrative paid PDF-to-text job. These records explain the decision; they are not transaction receipts.</p>
    <dl className={s.evidence}>
      <div><dt>Payment</dt><dd>Receipt-confirmed in this sample. The original order remains the source of payment authority.</dd></div>
      <div><dt>Problem</dt><dd>Delivery unresolved: the customer’s result link was missing.</dd></div>
      <div><dt>Investigation</dt><dd>Completed text output exists for the same job. Another processing attempt is unnecessary.</dd></div>
      <div><dt>Decision</dt><dd>Restore access to the existing output. No new payment, retry or refund.</dd></div>
      <div><dt>Outcome</dt><dd>Result available. Customer download is unverified; file expiry remains a separate state.</dd></div>
    </dl>
    <details className={s.details}><summary>When a result cannot be restored</summary><p>Mend may retry when policy permits, issue an eligible refund, or escalate. Overdue alone does not guarantee a refund. A refund is confirmed only by a successful receipt.</p></details>
    <button className={s.secondary} onClick={dismiss}>Back to the recovery</button>
  </dialog>;
}

export default function Outcome(){const [open,setOpen]=useState(false);const opener=useRef<HTMLElement|null>(null);return <><Story onEvidence={()=>{opener.current=document.activeElement as HTMLElement;setOpen(true);}}/><footer className={s.footer}><span>Evidence first. Action within policy. Escalation when uncertain.</span><Link className={s.textAction} href="/convert">Explore the PDF service <ArrowRight size={15} aria-hidden="true"/></Link></footer>{open?<Evidence close={()=>setOpen(false)} opener={opener.current}/>:null}</>;}
