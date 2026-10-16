import type {Metadata} from 'next';
import AppHeader from '../app-header';
import Purchase from '../purchase';
export const metadata:Metadata={title:'Mend · Convert',description:'Convert a supported PDF to private text on Arc testnet.'};
export default function ConvertPage(){return <div className="live-app"><AppHeader current="convert"/><main id="main" className="main" tabIndex={-1}><div className="page-heading"><div><p className="eyebrow">THE WORKING SERVICE</p><h1>A PDF in. Plain text out.</h1><p>Convert a supported document, then track delivery in My orders.</p></div></div><Purchase/></main></div>;}
