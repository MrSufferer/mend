// Local acceptance setup only. Owner credentials never reach the web process.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {neon} from '@neondatabase/serverless';
const owner=parseEnv(readFileSync(process.env.AUTH_FIXTURE_OWNER_ENV,'utf8'));
const db=neon(owner.DATABASE_URL_UNPOOLED);
if(process.argv[2]==='challenge') await db`UPDATE auth_challenges SET expires_at=now()-interval '1 second' WHERE id=${process.argv[3]}::uuid`;
else if(process.argv[2]==='session') await db`UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE wallet=${process.argv[3]}`;
else throw new Error('Unknown test fixture action');
