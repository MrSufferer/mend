import type {Metadata} from 'next';
import AppHeader from './app-header';
import Outcome from './outcome';
import s from './outcome.module.css';
export const metadata:Metadata={title:'Mend · Resolve failed paid jobs',description:'Mend resolves failed paid jobs for API businesses, with evidence-led recovery and escalation.'};
export default function Page(){return <div className="live-app"><AppHeader current="overview"/><main id="main" tabIndex={-1} className={s.main}><Outcome/></main></div>;}
