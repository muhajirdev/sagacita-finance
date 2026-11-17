/**
 * LPJ links: a secret, no-login URL the person holding a cash advance opens to fill their LPJ
 * (spend items + a receipt photo for each). Submitting puts it in "LPJ submitted, waiting finance review";
 * finance then settles the advance as usual (settleAdvance), using the submitted items as the lines.
 * The link stops working once the advance is settled.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { lpjLinks, transactions } from '#/db/schema'
import type { Db } from '#/lib/db'
import { FinanceError, log, settleAdvance, type Actor, type TransactionRow } from '#/lib/finance'

export const lpjItemSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  description: z.string().trim().min(1, 'describe each item').max(300),
  amount: z.number().int().min(1, 'amount must be more than 0'),
  documentId: z.number().int().nullable().optional(),
})
export type LpjItem = z.infer<typeof lpjItemSchema>

const newToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const lpjUrl = (appUrl: string, token: string) => `${appUrl}/lpj/${token}`

async function advanceRow(db: Db, id: number) {
  const [row] = await db.all<TransactionRow>(sql`select * from v_transactions where id = ${id}`)
  return row
}

function parseItems(text: string | null): LpjItem[] {
  if (!text) return []
  try {
    return JSON.parse(text) as LpjItem[]
  } catch {
    return []
  }
}

/** The LPJ link for a paid cash advance, made on first ask. */
export async function lpjLinkFor(db: Db, actor: Actor, appUrl: string, advanceId: number) {
  const adv = await advanceRow(db, advanceId)
  if (!adv || adv.kind !== 'cash_advance') throw new FinanceError(`cash advance ${advanceId} not found`)
  if (adv.status === 'settled') throw new FinanceError(`cash advance ${adv.number ?? adv.id} is already settled`)
  if (adv.status !== 'approved' || adv.outstanding > 0) throw new FinanceError(`cash advance ${adv.number ?? adv.id} is not paid yet; the LPJ link is for paid advances`)
  let link = await db.select().from(lpjLinks).where(eq(lpjLinks.advanceId, adv.id)).get()
  if (!link) {
    ;[link] = await db.insert(lpjLinks).values({ advanceId: adv.id, token: newToken(), createdBy: actor }).returning()
    await log(db, actor, 'create', 'lpj_links', link.id, { advanceId: adv.id })
  }
  const items = parseItems(link.items)
  return {
    advanceId: adv.id,
    number: adv.number,
    person: adv.requested_by ?? adv.party,
    amount: adv.total,
    lpjDue: adv.lpj_due,
    url: lpjUrl(appUrl, link.token),
    submittedAt: link.submittedAt,
    spent: items.reduce((a, i) => a + i.amount, 0),
    items,
  }
}

/** What the public page shows. Null when the token is unknown. */
export async function lpjByToken(db: Db, token: string) {
  if (!token || token.length < 20) return null
  const link = await db.select().from(lpjLinks).where(eq(lpjLinks.token, token)).get()
  if (!link) return null
  const adv = await advanceRow(db, link.advanceId)
  if (!adv) return null
  return {
    link,
    advance: {
      id: adv.id,
      number: adv.number,
      person: adv.requested_by ?? adv.party,
      project: adv.project_code ? `${adv.project_code}${adv.project_name ? ' · ' + adv.project_name : ''}` : (adv.category ?? 'Company'),
      description: adv.description,
      amount: adv.total,
      paidDate: adv.payment_list?.split('; ').pop()?.split(' ')[0] ?? null,
      lpjDue: adv.lpj_due,
      settled: adv.status === 'settled',
    },
    items: parseItems(link.items),
    note: link.note,
    submittedAt: link.submittedAt,
  }
}

/** The employee submits (or resubmits, until finance settles) their spend items. */
export async function submitLpj(db: Db, token: string, input: { items: LpjItem[]; note?: string | null }) {
  const got = await lpjByToken(db, token)
  if (!got) throw new FinanceError('This LPJ link is not valid.')
  if (got.advance.settled) throw new FinanceError('This advance is already settled; the link is closed.')
  if (!input.items.length) throw new FinanceError('Add at least one item.')
  const items = input.items.map((i) => lpjItemSchema.parse(i))
  const submittedAt = new Date().toISOString()
  await db
    .update(lpjLinks)
    .set({ items: JSON.stringify(items), note: input.note?.trim() || null, submittedAt })
    .where(eq(lpjLinks.id, got.link.id))
  await log(db, `LPJ link: ${got.advance.person ?? 'advance holder'}`, 'update', 'lpj_links', got.link.id, {
    advanceId: got.advance.id,
    items,
    note: input.note ?? null,
  })
  return { submittedAt, spent: items.reduce((a, i) => a + i.amount, 0), count: items.length }
}

/** Submitted LPJs for these advances, for the Expenses page. */
export async function lpjSubmissions(db: Db, advanceIds: number[]) {
  if (!advanceIds.length) return {}
  const rows = await db.select().from(lpjLinks).where(inArray(lpjLinks.advanceId, advanceIds.slice(0, 500)))
  const out: Record<number, { submittedAt: string | null; items: LpjItem[]; spent: number; note: string | null }> = {}
  for (const r of rows) {
    const items = parseItems(r.items)
    out[r.advanceId] = { submittedAt: r.submittedAt, items, spent: items.reduce((a, i) => a + i.amount, 0), note: r.note }
  }
  return out
}

/** Finance settles an advance from what the employee submitted: one LPJ line per item. */
export async function settleFromLpj(db: Db, actor: Actor, input: { advanceId: number; date?: string; createdBy?: number | null }) {
  const link = await db.select().from(lpjLinks).where(eq(lpjLinks.advanceId, input.advanceId)).get()
  const items = parseItems(link?.items ?? null)
  if (!link?.submittedAt || !items.length) throw new FinanceError('no LPJ has been submitted through the link for this advance')
  const adv = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, input.advanceId)).get()
  if (!adv) throw new FinanceError(`cash advance ${input.advanceId} not found`)
  return settleAdvance(db, actor, {
    advanceId: input.advanceId,
    lines: items.map((i) => ({ amount: i.amount, description: `${i.date} ${i.description}` })),
    date: input.date,
    note: link.note,
    createdBy: input.createdBy,
  })
}
