/**
 * Finance operations shared by the web UI and the MCP server.
 * Every write goes through here so tax math, budget checks and the activity log
 * are the same no matter who calls.
 */
import { and, asc, eq, sql } from 'drizzle-orm'

import {
  activityLog,
  opexBudgets,
  budgetLines,
  companies,
  divisions,
  parties,
  payments,
  projects,
  transactions,
  type PARTY_KINDS,
  type PROJECT_TYPES,
  type TRANSACTION_KINDS,
  type TRANSACTION_STATUSES,
} from '#/db/schema'
import type { Db } from '#/lib/db'
import { computeTax, type PphType } from '#/lib/tax'

export type Actor = string
export type TransactionKind = (typeof TRANSACTION_KINDS)[number]
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number]
export type PartyKind = (typeof PARTY_KINDS)[number]

export class FinanceError extends Error {}

const today = () => new Date().toISOString().slice(0, 10)

async function log(db: Db, actor: Actor, action: string, entity: string, entityId: number, data?: unknown) {
  await db.insert(activityLog).values({ actor, action, entity, entityId, data: data ?? null })
}

// ------------------------------------------------------------------ lookups

export async function listCompanies(db: Db) {
  return db.select().from(companies).orderBy(asc(companies.name))
}

export async function listDivisions(db: Db) {
  return db
    .select({ id: divisions.id, name: divisions.name, companyId: divisions.companyId, company: companies.name })
    .from(divisions)
    .innerJoin(companies, eq(companies.id, divisions.companyId))
    .orderBy(asc(divisions.name))
}

export async function listOpexCategories(db: Db, fiscalYear = new Date().getFullYear()) {
  return db.select().from(opexBudgets).where(eq(opexBudgets.fiscalYear, fiscalYear)).orderBy(asc(opexBudgets.sortOrder))
}

export async function listParties(db: Db, kind?: PartyKind) {
  return db
    .select()
    .from(parties)
    .where(kind ? eq(parties.kind, kind) : undefined)
    .orderBy(asc(parties.name))
}

/** Finds a party by name (case-insensitive) or creates it. */
export async function ensureParty(db: Db, actor: Actor, kind: PartyKind, name: string) {
  const clean = name.trim()
  if (!clean) throw new FinanceError('party name is empty')
  const found = await db
    .select()
    .from(parties)
    .where(and(eq(parties.kind, kind), sql`lower(${parties.name}) = lower(${clean})`))
    .get()
  if (found) return found
  const [created] = await db.insert(parties).values({ kind, name: clean }).returning()
  await log(db, actor, 'create', 'parties', created.id, created)
  return created
}

/** A project by numeric id or by its code (e.g. "HND-2026-01"). */
export async function findProject(db: Db, ref: string | number) {
  const asNumber = typeof ref === 'number' ? ref : /^\d+$/.test(ref) ? Number(ref) : null
  const row = await db
    .select()
    .from(projects)
    .where(asNumber != null ? eq(projects.id, asNumber) : sql`lower(${projects.code}) = lower(${String(ref)})`)
    .get()
  if (!row) throw new FinanceError(`project ${ref} not found`)
  return row
}

// ------------------------------------------------------------------ projects

export async function listProjects(db: Db) {
  const rows = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      type: projects.type,
      status: projects.status,
      startDate: projects.startDate,
      endDate: projects.endDate,
      client: parties.name,
      division: divisions.name,
    })
    .from(projects)
    .innerJoin(parties, eq(parties.id, projects.clientId))
    .innerJoin(divisions, eq(divisions.id, projects.divisionId))
    .orderBy(asc(projects.code))
  const budgets = await Promise.all(rows.map((p) => projectBudget(db, p.id)))
  return rows.map((p, i) => ({ ...p, totals: budgets[i].totals }))
}

export async function createProject(
  db: Db,
  actor: Actor,
  input: {
    code: string
    name: string
    clientName: string
    divisionId: number
    type: (typeof PROJECT_TYPES)[number]
    startDate?: string
    endDate?: string
  },
) {
  const client = await ensureParty(db, actor, 'client', input.clientName)
  const [row] = await db
    .insert(projects)
    .values({
      code: input.code.trim(),
      name: input.name.trim(),
      clientId: client.id,
      divisionId: input.divisionId,
      type: input.type,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
    })
    .returning()
  await log(db, actor, 'create', 'projects', row.id, row)
  return row
}

export async function addBudgetLine(
  db: Db,
  actor: Actor,
  input: { projectId: number; name: string; charge: number; maxExpense: number; asfAmount?: number },
) {
  const [row] = await db
    .insert(budgetLines)
    .values({
      projectId: input.projectId,
      name: input.name.trim(),
      charge: Math.round(input.charge),
      maxExpense: Math.round(input.maxExpense),
      asfAmount: Math.round(input.asfAmount ?? 0),
    })
    .returning()
  await log(db, actor, 'create', 'budget_lines', row.id, row)
  return row
}

/**
 * Budget vs actual per line. Ceiling = max_expense + asf_amount (old dashboard rule).
 * Actual = DPP of non-void outgoing transactions on that line (cost before tax).
 */
export async function projectBudget(db: Db, projectId: number) {
  const lines = await db
    .select()
    .from(budgetLines)
    .where(eq(budgetLines.projectId, projectId))
    .orderBy(asc(budgetLines.sortOrder), asc(budgetLines.id))
  const spend = await db
    .select({ lineId: transactions.budgetLineId, actual: sql<number>`coalesce(sum(${transactions.dpp}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.projectId, projectId),
        eq(transactions.direction, 'out'),
        sql`${transactions.status} != 'void'`,
      ),
    )
    .groupBy(transactions.budgetLineId)
  const billed = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.dpp}), 0)` })
    .from(transactions)
    .where(
      and(eq(transactions.projectId, projectId), eq(transactions.direction, 'in'), sql`${transactions.status} != 'void'`),
    )
    .get()
  const byLine = new Map(spend.map((s) => [s.lineId, Number(s.actual)]))
  const rows = lines.map((l) => {
    const ceiling = l.maxExpense + l.asfAmount
    const actual = byLine.get(l.id) ?? 0
    return {
      ...l,
      ceiling,
      actual,
      remaining: ceiling - actual,
      usedPct: ceiling ? Math.round((actual / ceiling) * 1000) / 10 : 0,
      estMargin: l.charge - ceiling,
      actualMargin: l.charge - actual,
    }
  })
  const sum = (k: 'charge' | 'ceiling' | 'actual' | 'asfAmount') => rows.reduce((a, r) => a + r[k], 0)
  const unbudgeted = byLine.get(null) ?? 0
  const totals = {
    charge: sum('charge'),
    asf: sum('asfAmount'),
    ceiling: sum('ceiling'),
    actual: sum('actual') + unbudgeted,
    unbudgeted,
    remaining: sum('ceiling') - sum('actual') - unbudgeted,
    usedPct: sum('ceiling') ? Math.round(((sum('actual') + unbudgeted) / sum('ceiling')) * 1000) / 10 : 0,
    actualMargin: sum('charge') - sum('actual') - unbudgeted,
    billed: Number(billed?.total ?? 0),
  }
  return { lines: rows, totals }
}

// ------------------------------------------------------------------ transactions

export type RecordTransactionInput = {
  kind: TransactionKind
  projectId?: number | null
  budgetLineId?: number | null
  /** Required when there is no project (company spend). */
  companyId?: number | null
  /** Division for company spend with no project. */
  divisionId?: number | null
  /** Vendor / employee / client name; created if it does not exist. Clients come from the project when omitted. */
  partyName?: string | null
  category?: string | null
  description?: string | null
  number?: string | null
  issueDate?: string | null
  dueDate?: string | null
  dpp: number
  withPpn?: boolean
  pphType?: PphType
  pph?: number
  status?: TransactionStatus
  requestedBy?: string | null
  attachmentUrl?: string | null
  source?: 'web' | 'whatsapp' | 'import'
  createdBy?: number | null
}

export async function recordTransaction(db: Db, actor: Actor, input: RecordTransactionInput) {
  const direction = input.kind === 'client_invoice' ? 'in' : 'out'
  const tax = computeTax({ dpp: input.dpp, withPpn: input.withPpn, pphType: input.pphType, pph: input.pph })

  let companyId = input.companyId ?? null
  let partyId: number | null = null
  let project: typeof projects.$inferSelect | null = null
  if (input.projectId) {
    project = await findProject(db, input.projectId)
    const division = await db.select().from(divisions).where(eq(divisions.id, project.divisionId)).get()
    companyId ??= division?.companyId ?? null
    if (direction === 'in') partyId = project.clientId
  }
  if (!companyId) throw new FinanceError('companyId is required when there is no project')

  if (input.budgetLineId) {
    const line = await db.select().from(budgetLines).where(eq(budgetLines.id, input.budgetLineId)).get()
    if (!line || line.projectId !== project?.id)
      throw new FinanceError('budget line does not belong to this project')
  }
  if (input.partyName) {
    const kind: PartyKind = direction === 'in' ? 'client' : input.kind === 'vendor_bill' ? 'vendor' : 'employee'
    partyId = (await ensureParty(db, actor, kind, input.partyName)).id
  }

  const [row] = await db
    .insert(transactions)
    .values({
      kind: input.kind,
      direction,
      status: input.status ?? 'draft',
      number: input.number || null,
      companyId,
      partyId,
      projectId: project?.id ?? null,
      budgetLineId: input.budgetLineId ?? null,
      divisionId: project ? null : (input.divisionId ?? null),
      category: input.category || null,
      description: input.description || null,
      issueDate: input.issueDate || today(),
      dueDate: input.dueDate || null,
      ...tax,
      requestedBy: input.requestedBy || null,
      attachmentUrl: input.attachmentUrl || null,
      source: input.source ?? 'web',
      createdBy: input.createdBy ?? null,
    })
    .returning()
  await log(db, actor, 'create', 'transactions', row.id, row)

  let warning: string | null = null
  if (row.budgetLineId && project) {
    const budget = await projectBudget(db, project.id)
    const line = budget.lines.find((l) => l.id === row.budgetLineId)
    if (line && line.actual > line.ceiling)
      warning = `Budget line "${line.name}" is now over its ceiling: spent Rp ${line.actual.toLocaleString('id-ID')} of Rp ${line.ceiling.toLocaleString('id-ID')}.`
  }
  return { transaction: row, warning }
}

export async function setTransactionStatus(db: Db, actor: Actor, id: number, status: TransactionStatus) {
  const [row] = await db
    .update(transactions)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(transactions.id, id))
    .returning()
  if (!row) throw new FinanceError(`transaction ${id} not found`)
  await log(db, actor, 'update', 'transactions', id, { status })
  return row
}

async function paidSoFar(db: Db, transactionId: number) {
  const r = await db
    .select({ paid: sql<number>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .where(eq(payments.transactionId, transactionId))
    .get()
  return Number(r?.paid ?? 0)
}

/** Records cash that moved against a transaction. Partial payments are fine; overpaying is refused. */
export async function recordPayment(
  db: Db,
  actor: Actor,
  input: { transactionId: number; amount?: number; date?: string; method?: string; reference?: string; note?: string; createdBy?: number | null },
) {
  const tx = await db.select().from(transactions).where(eq(transactions.id, input.transactionId)).get()
  if (!tx) throw new FinanceError(`transaction ${input.transactionId} not found`)
  if (tx.status === 'void') throw new FinanceError('transaction is void')
  const outstanding = tx.total - (await paidSoFar(db, tx.id))
  const amount = Math.round(input.amount ?? outstanding)
  if (amount <= 0) throw new FinanceError('nothing outstanding on this transaction')
  if (amount > outstanding) throw new FinanceError(`amount ${amount} is more than the outstanding ${outstanding}`)
  const [row] = await db
    .insert(payments)
    .values({
      transactionId: tx.id,
      direction: tx.direction,
      amount,
      date: input.date || today(),
      companyId: tx.companyId,
      method: input.method || null,
      reference: input.reference || null,
      note: input.note || null,
      createdBy: input.createdBy ?? null,
    })
    .returning()
  await log(db, actor, 'pay', 'transactions', tx.id, row)
  return { payment: row, outstanding: outstanding - amount }
}

// ------------------------------------------------------------------ reads over the view

export type TransactionFilter = {
  projectId?: number
  direction?: 'in' | 'out'
  kind?: TransactionKind
  status?: TransactionStatus
  openOnly?: boolean
  dueBy?: string
  limit?: number
}

export type TransactionRow = {
  id: number
  kind: TransactionKind
  direction: 'in' | 'out'
  status: TransactionStatus
  number: string | null
  issue_date: string
  due_date: string | null
  dpp: number
  ppn: number
  pph_type: string
  pph: number
  total: number
  paid: number
  outstanding: number
  overdue: number
  category: string | null
  description: string | null
  requested_by: string | null
  source: string
  company: string
  division: string | null
  project_id: number | null
  project_code: string | null
  project_name: string | null
  client: string | null
  budget_line_id: number | null
  budget_line: string | null
  party: string | null
}

export async function listTransactions(d1: D1Database, f: TransactionFilter = {}) {
  const where: string[] = []
  const args: unknown[] = []
  if (f.projectId) (where.push('project_id = ?'), args.push(f.projectId))
  if (f.direction) (where.push('direction = ?'), args.push(f.direction))
  if (f.kind) (where.push('kind = ?'), args.push(f.kind))
  if (f.status) (where.push('status = ?'), args.push(f.status))
  if (f.openOnly) where.push("outstanding > 0 and status != 'void'")
  if (f.dueBy) (where.push('due_date <= ?'), args.push(f.dueBy))
  const q = `select * from v_transactions ${where.length ? 'where ' + where.join(' and ') : ''}
    order by coalesce(due_date, issue_date) desc, id desc limit ?`
  args.push(Math.min(f.limit ?? 200, 1000))
  const { results } = await d1.prepare(q).bind(...args).all<TransactionRow>()
  return results
}

/** Unpaid approved bills/advances/reimbursements due by a date: the Wed/Fri payment run. */
export async function payablesDue(d1: D1Database, dueBy: string) {
  const { results } = await d1
    .prepare(
      `select * from v_transactions
       where direction = 'out' and status = 'approved' and outstanding > 0
         and (due_date is null or due_date <= ?)
       order by due_date is null, due_date, party`,
    )
    .bind(dueBy)
    .all<TransactionRow>()
  return { items: results, totalOutstanding: results.reduce((a, r) => a + r.outstanding, 0) }
}

// ------------------------------------------------------------------ read-only SQL for the agent

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|begin|commit|rollback|savepoint)\b/i

/** Runs one read-only SELECT. Users (password hashes) and payroll (owner/hr only) cannot be read. */
export async function readonlyQuery(d1: D1Database, query: string, limit = 500) {
  const q = query.trim().replace(/;\s*$/, '')
  if (!/^(select|with)\b/i.test(q)) throw new FinanceError('only SELECT / WITH queries are allowed')
  if (q.includes(';')) throw new FinanceError('one statement only')
  if (FORBIDDEN.test(q)) throw new FinanceError('read-only: that keyword is not allowed')
  if (/\busers\b|password_hash|payroll_months|sqlite_master|_cf_/i.test(q)) throw new FinanceError('that table is not readable')
  const { results } = await d1.prepare(`select * from (${q}) limit ${Math.min(limit, 1000)}`).all()
  return results
}
