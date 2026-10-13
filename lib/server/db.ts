import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';
let cached:ReturnType<typeof drizzle<typeof schema>>;
export function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return cached ??= drizzle(neon(process.env.DATABASE_URL), {schema});
}
