import { verify } from '../../../../lib/server/auth';
import { handle } from '../../../../lib/server/http';
export const runtime='nodejs';
export async function POST(request:Request) {return handle(()=>verify(request));}
