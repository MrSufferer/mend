import {handle} from '../../../../../lib/server/http';
import {purchase} from '../../../../../lib/server/payments';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {return handle(async()=>purchase(request,(await params).id));}
