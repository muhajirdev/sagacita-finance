import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from '#/db/schema'

export const getDb = (d1: D1Database = env.DB) => drizzle(d1, { schema })
export type Db = ReturnType<typeof getDb>
