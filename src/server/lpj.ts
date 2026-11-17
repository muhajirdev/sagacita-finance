/** Server functions for LPJ links: the public (no-login) page, and finance's copy-link / settle actions. */
import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { users } from '#/db/schema'
import { SESSION_COOKIE, readSession } from '#/lib/auth'
import { getDb } from '#/lib/db'
import { lpjByToken, lpjItemSchema, lpjLinkFor, lpjSubmissions, settleFromLpj, submitLpj } from '#/lib/lpj'

async function financeUser() {
  const id = await readSession(getCookie(SESSION_COOKIE), env.SESSION_SECRET)
  const user = id ? await getDb().select().from(users).where(eq(users.id, id)).get() : null
  if (!user) throw new Error('Not signed in')
  if (!['owner', 'finance', 'admin'].includes(user.role)) throw new Error("You don't have access to this section")
  return user
}

const appUrl = () => env.APP_URL || 'https://sagacita-finance.qalam.workers.dev'

// ---- public: anyone holding the secret token

export const getLpjPublic = createServerFn()
  .validator(z.object({ token: z.string().max(100) }))
  .handler(async ({ data }) => {
    const got = await lpjByToken(getDb(), data.token)
    if (!got) return null
    const { link: _link, ...rest } = got
    return rest
  })

export const submitLpjPublic = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().max(100), items: z.array(lpjItemSchema).min(1).max(100), note: z.string().max(1000).optional() }))
  .handler(async ({ data }) => submitLpj(getDb(), data.token, { items: data.items, note: data.note }))

// ---- finance

export const lpjLinkFn = createServerFn({ method: 'POST' })
  .validator(z.object({ advanceId: z.number().int() }))
  .handler(async ({ data }) => {
    const user = await financeUser()
    return lpjLinkFor(getDb(), user.email, appUrl(), data.advanceId)
  })

export const getLpjSubmissions = createServerFn({ method: 'POST' })
  .validator(z.object({ advanceIds: z.array(z.number().int()) }))
  .handler(async ({ data }) => {
    await financeUser()
    return lpjSubmissions(getDb(), data.advanceIds)
  })

export const settleFromLpjFn = createServerFn({ method: 'POST' })
  .validator(z.object({ advanceId: z.number().int(), date: z.string().optional() }))
  .handler(async ({ data }) => {
    const user = await financeUser()
    return settleFromLpj(getDb(), user.email, { ...data, createdBy: user.id })
  })
