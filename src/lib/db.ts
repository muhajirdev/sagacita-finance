import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from '#/db/schema'

/** Where a write came from. Stored on every activity_log row. */
export type AuditSource = { source: 'web' | 'mcp' | 'import'; batchId?: string }

const sources = new WeakMap<object, AuditSource>()

/**
 * A Drizzle handle. Pass the audit source when it isn't the web app, e.g.
 * getDb(env.DB, { source: 'mcp' }) or getDb(env.DB, { source: 'import', batchId }).
 */
export const getDb = (d1: D1Database = env.DB, audit: AuditSource = { source: 'web' }) => {
  const db = drizzle(d1, { schema })
  sources.set(db, audit)
  return db
}
export type Db = ReturnType<typeof getDb>

export const auditSource = (db: Db): AuditSource => sources.get(db) ?? { source: 'web' }
