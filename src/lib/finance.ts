/**
 * Finance operations shared by the web UI and the MCP server.
 * Every write goes through here so tax math, budget checks and the activity log
 * are the same no matter who calls.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

import {
  documents,
  payrollMonths,
  activityLog,
  approvals,
  opexBudgets,
  budgetLines,
  companies,
  divisions,
  parties,
  payments,
  projects,
  transactions,
  users,
  type USER_ROLES,
  type PARTY_KINDS,
  type PROJECT_TYPES,
  type TRANSACTION_KINDS,
  type TRANSACTION_STATUSES,
} from '#/db/schema'
import { hashPassword } from '#/lib/auth'
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
      status: 'draft',
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
    .where(and(eq(transactions.projectId, projectId), eq(transactions.direction, 'out'), sql`${transactions.status} != 'void'`))
    .groupBy(transactions.budgetLineId)
  const billed = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.dpp}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.projectId, projectId), eq(transactions.direction, 'in'), sql`${transactions.status} != 'void'`))
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

/** Edit a project's details (not its status: that goes through approval / set_project_status). */
export async function updateProject(
  db: Db,
  actor: Actor,
  id: number,
  input: {
    code?: string
    name?: string
    clientName?: string
    divisionId?: number
    type?: (typeof PROJECT_TYPES)[number]
    startDate?: string | null
    endDate?: string | null
  },
) {
  const set: Partial<typeof projects.$inferInsert> = {}
  if (input.code) set.code = input.code.trim()
  if (input.name) set.name = input.name.trim()
  if (input.clientName) set.clientId = (await ensureParty(db, actor, 'client', input.clientName)).id
  if (input.divisionId) set.divisionId = input.divisionId
  if (input.type) set.type = input.type
  if (input.startDate !== undefined) set.startDate = input.startDate || null
  if (input.endDate !== undefined) set.endDate = input.endDate || null
  const [row] = await db.update(projects).set(set).where(eq(projects.id, id)).returning()
  if (!row) throw new FinanceError(`project ${id} not found`)
  await log(db, actor, 'update', 'projects', id, set)
  return row
}

/**
 * Change a budget line. Changing amounts on an approved (active) project is allowed but flagged,
 * because the approved budget no longer matches.
 */
export async function updateBudgetLine(
  db: Db,
  actor: Actor,
  id: number,
  input: { name?: string; charge?: number; maxExpense?: number; asfAmount?: number },
) {
  const line = await db.select().from(budgetLines).where(eq(budgetLines.id, id)).get()
  if (!line) throw new FinanceError(`budget line ${id} not found`)
  const set: Partial<typeof budgetLines.$inferInsert> = {}
  if (input.name) set.name = input.name.trim()
  if (input.charge !== undefined) set.charge = Math.round(input.charge)
  if (input.maxExpense !== undefined) set.maxExpense = Math.round(input.maxExpense)
  if (input.asfAmount !== undefined) set.asfAmount = Math.round(input.asfAmount)
  if (!Object.keys(set).length) throw new FinanceError('nothing to change')
  const [row] = await db.update(budgetLines).set(set).where(eq(budgetLines.id, id)).returning()
  await log(db, actor, 'update', 'budget_lines', id, { before: line, after: set })
  const project = await db.select().from(projects).where(eq(projects.id, line.projectId)).get()
  const amountsChanged = input.charge !== undefined || input.maxExpense !== undefined || input.asfAmount !== undefined
  const warning =
    amountsChanged && project?.status === 'active'
      ? `Budget of approved project ${project.code} changed; tell the owner (the change is in the activity log).`
      : null
  return { line: row, warning }
}

/** Removes a budget line that has no transactions on it. */
export async function deleteBudgetLine(db: Db, actor: Actor, id: number) {
  const used = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.budgetLineId, id)).get()
  if (used) throw new FinanceError('budget line has transactions; move or void them first')
  const [row] = await db.delete(budgetLines).where(eq(budgetLines.id, id)).returning()
  if (!row) throw new FinanceError(`budget line ${id} not found`)
  await log(db, actor, 'delete', 'budget_lines', id, row)
  return { deleted: row }
}

/** Close or reopen a project. Draft -> active only happens through budget approval. */
/** Set a Company OpEx category's annual budget for a year (creates the category if new). */
export async function setOpexBudget(db: Db, actor: Actor, input: { category: string; year: number; annualBudget: number }) {
  const category = input.category.trim()
  if (!category) throw new FinanceError('category is required')
  const annualBudget = Math.round(input.annualBudget)
  const [row] = await db
    .insert(opexBudgets)
    .values({ category, fiscalYear: input.year, annualBudget })
    .onConflictDoUpdate({ target: [opexBudgets.category, opexBudgets.fiscalYear], set: { annualBudget } })
    .returning()
  await log(db, actor, 'update', 'opex_budgets', row.id, { category, year: input.year, annualBudget })
  return row
}

export async function setProjectStatus(db: Db, actor: Actor, project: string | number, status: 'active' | 'closed') {
  const p = await findProject(db, project)
  if (p.status === 'draft') throw new FinanceError(`project ${p.code} is draft; its budget must be approved first (submit_budget)`)
  const [row] = await db.update(projects).set({ status }).where(eq(projects.id, p.id)).returning()
  await log(db, actor, 'update', 'projects', p.id, { status })
  return row
}

/** Update a client / vendor / employee: name, NPWP, bank account, notes. */
export async function updateParty(
  db: Db,
  actor: Actor,
  id: number,
  input: { name?: string; npwp?: string | null; bankAccount?: string | null; notes?: string | null },
) {
  const set: Partial<typeof parties.$inferInsert> = {}
  if (input.name) set.name = input.name.trim()
  for (const k of ['npwp', 'bankAccount', 'notes'] as const) if (input[k] !== undefined) set[k] = input[k] || null
  if (!Object.keys(set).length) throw new FinanceError('nothing to change')
  const [row] = await db.update(parties).set(set).where(eq(parties.id, id)).returning()
  if (!row) throw new FinanceError(`party ${id} not found`)
  await log(db, actor, 'update', 'parties', id, set)
  return row
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

/** Prefix on approval summaries for spend over a budget line's ceiling. Only decideApproval can clear these. */
export const OVER_CEILING = 'Over ceiling'

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

  // Spend that would push a budget line over its ceiling always waits for the owner's approval.
  let overCeiling: string | null = null
  if (input.budgetLineId) {
    const line = await db.select().from(budgetLines).where(eq(budgetLines.id, input.budgetLineId)).get()
    if (!line || line.projectId !== project?.id) throw new FinanceError('budget line does not belong to this project')
    if (direction === 'out' && input.status !== 'void') {
      const bl = (await projectBudget(db, project.id)).lines.find((l) => l.id === line.id)
      if (bl && bl.actual + tax.dpp > bl.ceiling)
        overCeiling = `${OVER_CEILING} "${bl.name}": Rp ${(bl.actual + tax.dpp).toLocaleString('id-ID')} of Rp ${bl.ceiling.toLocaleString('id-ID')}`
    }
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
      // all new outgoing spend goes through the approval flow (imports of old data keep their status)
      status: direction === 'out' && input.source !== 'import' && input.status !== 'void' ? 'draft' : (input.status ?? 'draft'),
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

  let approval: typeof approvals.$inferSelect | null = null
  if (row.direction === 'out' && row.status === 'draft') {
    approval = await requestApproval(db, actor, {
      entity: 'transaction',
      entityId: row.id,
      amount: row.total,
      summary: (overCeiling ? overCeiling + ' | ' : '') + spendSummary(row, input.partyName || null, project?.code ?? null),
    })
  }

  let warning: string | null = project?.status === 'draft' ? `Project ${project.code} budget is not approved yet.` : null
  if (row.budgetLineId && project) {
    const budget = await projectBudget(db, project.id)
    const line = budget.lines.find((l) => l.id === row.budgetLineId)
    if (line && line.actual > line.ceiling)
      warning =
        (warning ? warning + ' ' : '') +
        `Budget line "${line.name}" is over its ceiling (Rp ${line.actual.toLocaleString('id-ID')} of Rp ${line.ceiling.toLocaleString('id-ID')}), so this expense is waiting for the owner's approval.`
  }
  return { transaction: row, warning, approval }
}

export async function setTransactionStatus(db: Db, actor: Actor, id: number, status: TransactionStatus) {
  if (status !== 'draft' && status !== 'void') {
    const pending = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.entity, 'transaction'), eq(approvals.entityId, id), eq(approvals.status, 'pending')))
      .get()
    if (pending)
      throw new FinanceError(
        `this expense is waiting in Approvals (#${pending.id}): finance PIC acknowledges and sets a pay date, then BOD releases it`,
      )
  }
  const [row] = await db
    .update(transactions)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(transactions.id, id))
    .returning()
  if (!row) throw new FinanceError(`transaction ${id} not found`)
  await log(db, actor, 'update', 'transactions', id, { status })
  if (status === 'approved' || status === 'void')
    await closePending(db, actor, 'transaction', id, status === 'approved' ? 'approved' : 'rejected')
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
  input: {
    transactionId: number
    amount?: number
    date?: string
    method?: string
    reference?: string
    note?: string
    createdBy?: number | null
  },
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

function spendSummary(t: typeof transactions.$inferSelect, partyName: string | null, projectCode: string | null) {
  const who = partyName || t.category || 'company'
  return `${KIND_TEXT[t.kind]} ${who}, Rp ${t.total.toLocaleString('id-ID')} (${projectCode ?? 'company spend'})${t.description ? ': ' + t.description : ''}`
}

/**
 * Fix a transaction that has no payments yet (typo in amount, date, vendor, line...).
 * Tax is recomputed when dpp / PPN / PPh change. A pending approval is updated to match.
 */
export async function updateTransaction(
  db: Db,
  actor: Actor,
  id: number,
  input: {
    budgetLineId?: number | null
    partyName?: string
    category?: string | null
    description?: string | null
    number?: string | null
    issueDate?: string
    dueDate?: string | null
    dpp?: number
    withPpn?: boolean
    pphType?: PphType
    pph?: number
    requestedBy?: string | null
    attachmentUrl?: string | null
  },
) {
  const tx = await db.select().from(transactions).where(eq(transactions.id, id)).get()
  if (!tx) throw new FinanceError(`transaction ${id} not found`)
  if (tx.status === 'void' || tx.status === 'settled') throw new FinanceError(`transaction ${id} is ${tx.status}; it can't be edited`)
  if ((await paidSoFar(db, id)) > 0) throw new FinanceError('transaction already has payments; undo them first (undo_payment) or void it')

  const set: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date().toISOString() }
  if (input.budgetLineId !== undefined) {
    if (input.budgetLineId != null) {
      const line = await db.select().from(budgetLines).where(eq(budgetLines.id, input.budgetLineId)).get()
      if (!line || line.projectId !== tx.projectId) throw new FinanceError('budget line does not belong to this project')
    }
    set.budgetLineId = input.budgetLineId
  }
  let partyName: string | null = null
  if (input.partyName) {
    const kind: PartyKind = tx.direction === 'in' ? 'client' : tx.kind === 'vendor_bill' ? 'vendor' : 'employee'
    const party = await ensureParty(db, actor, kind, input.partyName)
    set.partyId = party.id
    partyName = party.name
  }
  for (const k of ['category', 'description', 'number', 'issueDate', 'dueDate', 'requestedBy', 'attachmentUrl'] as const)
    if (input[k] !== undefined) (set as Record<string, unknown>)[k] = input[k] || null
  if (input.dpp !== undefined || input.withPpn !== undefined || input.pphType !== undefined || input.pph !== undefined) {
    const pphType = input.pphType ?? (tx.pphType as PphType)
    Object.assign(
      set,
      computeTax({
        dpp: input.dpp ?? tx.dpp,
        withPpn: input.withPpn ?? tx.ppn > 0,
        pphType,
        pph: input.pph ?? (input.pphType === undefined && input.dpp === undefined ? tx.pph : undefined),
      }),
    )
  }
  const [row] = await db.update(transactions).set(set).where(eq(transactions.id, id)).returning()
  await log(db, actor, 'update', 'transactions', id, input)

  if (!partyName && row.partyId) partyName = (await db.select().from(parties).where(eq(parties.id, row.partyId)).get())?.name ?? null
  const project = row.projectId ? await db.select().from(projects).where(eq(projects.id, row.projectId)).get() : null
  await db
    .update(approvals)
    .set({ amount: row.total, summary: spendSummary(row, partyName, project?.code ?? null) })
    .where(and(eq(approvals.entity, 'transaction'), eq(approvals.entityId, id), eq(approvals.status, 'pending')))
  return row
}

/** Removes a payment recorded by mistake. */
export async function undoPayment(db: Db, actor: Actor, paymentId: number) {
  const [row] = await db.delete(payments).where(eq(payments.id, paymentId)).returning()
  if (!row) throw new FinanceError(`payment ${paymentId} not found`)
  await log(db, actor, 'delete', 'payments', paymentId, row)
  return { deleted: row }
}

// ------------------------------------------------------------------ approvals

const KIND_TEXT: Record<string, string> = {
  client_invoice: 'Client invoice',
  vendor_bill: 'Vendor bill',
  cash_advance: 'Cash advance',
  reimbursement: 'Reimbursement',
}

type ApprovalEntity = (typeof approvals.$inferSelect)['entity']

/** Opens an approval request, or returns the pending one already open for the same thing. */
export async function requestApproval(
  db: Db,
  actor: Actor,
  input: { entity: ApprovalEntity; entityId: number; summary: string; amount?: number; note?: string },
) {
  const open = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.entity, input.entity), eq(approvals.entityId, input.entityId), eq(approvals.status, 'pending')))
    .get()
  if (open) return open
  const [row] = await db
    .insert(approvals)
    .values({ ...input, amount: input.amount ?? 0, note: input.note ?? null, requestedBy: actor })
    .returning()
  await log(db, actor, 'create', 'approvals', row.id, row)
  return row
}

async function closePending(db: Db, actor: Actor, entity: ApprovalEntity, entityId: number, status: 'approved' | 'rejected') {
  await db
    .update(approvals)
    .set({ status, decidedBy: actor, decidedAt: new Date().toISOString() })
    .where(and(eq(approvals.entity, entity), eq(approvals.entityId, entityId), eq(approvals.status, 'pending')))
}

/** Asks for the project's budget (its budget lines) to be approved before the project runs. */
export async function submitBudget(db: Db, actor: Actor, project: string | number, note?: string) {
  const p = await findProject(db, project)
  if (p.status !== 'draft') throw new FinanceError(`project ${p.code} is ${p.status}; only draft projects need budget approval`)
  const budget = await projectBudget(db, p.id)
  if (budget.lines.length === 0) throw new FinanceError('add budget lines before asking for approval')
  const t = budget.totals
  return requestApproval(db, actor, {
    entity: 'project',
    entityId: p.id,
    amount: t.ceiling,
    note,
    summary: `Budget ${p.code} ${p.name}: ${budget.lines.length} lines, charge Rp ${t.charge.toLocaleString('id-ID')}, expense ceiling Rp ${t.ceiling.toLocaleString('id-ID')}, est. margin Rp ${(t.charge - t.ceiling).toLocaleString('id-ID')}`,
  })
}

/** Approve: transaction -> approved, project -> active. Reject: transaction -> void, project stays draft. */
/** Spend flow step 2+3: finance PIC acknowledges a spend request and proposes when to pay it. */
export async function acknowledgeSpend(db: Db, actor: Actor, id: number, payDate: string) {
  const a = await db.select().from(approvals).where(eq(approvals.id, id)).get()
  if (!a || a.entity !== 'transaction') throw new FinanceError(`spend approval ${id} not found`)
  if (a.status !== 'pending') throw new FinanceError(`approval ${id} is already ${a.status}`)
  const now = new Date().toISOString()
  const [row] = await db
    .update(approvals)
    .set({ acknowledgedBy: actor, acknowledgedAt: now, payDate })
    .where(eq(approvals.id, id))
    .returning()
  await db.update(transactions).set({ dueDate: payDate, updatedAt: now }).where(eq(transactions.id, a.entityId))
  await log(db, actor, 'acknowledge', 'approvals', id, { payDate })
  return row
}

export async function decideApproval(db: Db, actor: Actor, id: number, decision: 'approve' | 'reject', note?: string) {
  const a = await db.select().from(approvals).where(eq(approvals.id, id)).get()
  if (!a) throw new FinanceError(`approval ${id} not found`)
  if (a.status !== 'pending') throw new FinanceError(`approval ${id} is already ${a.status} by ${a.decidedBy}`)
  if (decision === 'approve' && a.entity === 'transaction' && !a.acknowledgedAt)
    throw new FinanceError(`approval ${id} needs the finance PIC to acknowledge it and set a pay date before BOD can release it`)
  const status = decision === 'approve' ? 'approved' : 'rejected'
  const [row] = await db
    .update(approvals)
    .set({ status, decidedBy: actor, decidedAt: new Date().toISOString(), note: note ?? a.note })
    .where(eq(approvals.id, id))
    .returning()
  await log(db, actor, decision, 'approvals', id, { note })
  if (a.entity === 'transaction') {
    const tx = await db.select().from(transactions).where(eq(transactions.id, a.entityId)).get()
    if (tx && tx.status === 'draft') {
      const next = decision === 'approve' ? 'approved' : 'void'
      await db.update(transactions).set({ status: next, updatedAt: new Date().toISOString() }).where(eq(transactions.id, tx.id))
      await log(db, actor, 'update', 'transactions', tx.id, { status: next, approval: id })
    }
  } else if (decision === 'approve') {
    await db
      .update(projects)
      .set({ status: 'active' })
      .where(and(eq(projects.id, a.entityId), eq(projects.status, 'draft')))
    await log(db, actor, 'update', 'projects', a.entityId, { status: 'active', approval: id })
  }
  return row
}

/**
 * Approval queue. unnotified=true returns only pending requests not yet posted to WhatsApp
 * and marks them posted, so a routine can call it every few minutes without repeats.
 */
export async function listApprovals(
  db: Db,
  f: { status?: 'pending' | 'approved' | 'rejected'; unnotified?: boolean; limit?: number } = {},
) {
  const where = f.unnotified
    ? and(eq(approvals.status, 'pending'), isNull(approvals.notifiedAt))
    : f.status
      ? eq(approvals.status, f.status)
      : undefined
  const rows = await db
    .select()
    .from(approvals)
    .where(where)
    .orderBy(desc(approvals.id))
    .limit(Math.min(f.limit ?? 50, 200))
  if (f.unnotified && rows.length) {
    const now = new Date().toISOString()
    for (const r of rows) await db.update(approvals).set({ notifiedAt: now }).where(eq(approvals.id, r.id))
  }
  return rows
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
  attachment_url: string | null
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
  const { results } = await d1
    .prepare(q)
    .bind(...args)
    .all<TransactionRow>()
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

/**
 * Profit and loss for a year in one call (for dashboards, so they don't fan out into many queries).
 * Cost = DPP of non-void outgoing rows (before tax). Project cost has a project; OpEx has none.
 * Payroll is reported separately (payroll_summary).
 */
export async function pnlReport(d1: D1Database, year: number) {
  const y = String(year)
  const monthly = (
    await d1
      .prepare(
        `select substr(issue_date, 1, 7) as month,
           sum(case when direction = 'in' then dpp else 0 end) as billed,
           sum(case when direction = 'out' and project_id is not null then dpp else 0 end) as project_cost,
           sum(case when direction = 'out' and project_id is null then dpp else 0 end) as opex
         from v_transactions where status != 'void' and substr(issue_date, 1, 4) = ?
         group by month order by month`,
      )
      .bind(y)
      .all<{ month: string; billed: number; project_cost: number; opex: number }>()
  ).results
  const collected = await d1
    .prepare(`select coalesce(sum(amount), 0) as v from payments where direction = 'in' and substr(date, 1, 4) = ?`)
    .bind(y)
    .first<{ v: number }>()
  const projectRows = (
    await d1
      .prepare(
        `select p.id, p.code, p.name, p.status, c.name as client, d.name as division,
           (select coalesce(sum(charge), 0) from budget_lines b where b.project_id = p.id) as contract,
           (select coalesce(sum(max_expense + asf_amount), 0) from budget_lines b where b.project_id = p.id) as budget,
           (select coalesce(sum(dpp), 0) from transactions t where t.project_id = p.id and t.direction = 'out' and t.status != 'void') as cost,
           (select coalesce(sum(dpp), 0) from transactions t where t.project_id = p.id and t.direction = 'in' and t.status != 'void') as billed
         from projects p join parties c on c.id = p.client_id join divisions d on d.id = p.division_id
         where coalesce(substr(p.start_date, 1, 4), ?) <= ? and coalesce(substr(p.end_date, 1, 4), ?) >= ?
         order by p.code`,
      )
      .bind(y, y, y, y)
      .all<{
        id: number
        code: string
        name: string
        status: string
        client: string
        division: string
        contract: number
        budget: number
        cost: number
        billed: number
      }>()
  ).results
  const projects = projectRows.map((p) => ({
    ...p,
    margin: p.contract - p.cost,
    marginPct: p.contract ? Math.round(((p.contract - p.cost) / p.contract) * 1000) / 10 : 0,
  }))
  const sum = (k: 'contract' | 'cost' | 'billed') => projects.reduce((a, p) => a + p[k], 0)
  const opex = monthly.reduce((a, m) => a + m.opex, 0)
  const contract = sum('contract')
  const projectCost = sum('cost')
  const grossProfit = contract - projectCost
  return {
    year,
    totals: {
      contract,
      projectCost,
      grossProfit,
      grossMarginPct: contract ? Math.round((grossProfit / contract) * 1000) / 10 : 0,
      opex,
      operatingProfit: grossProfit - opex,
      billed: sum('billed'),
      collected: collected?.v ?? 0,
      projects: projects.length,
      activeProjects: projects.filter((p) => p.status === 'active').length,
    },
    monthly,
    projects,
    notes: 'Amounts in rupiah, before PPN. Cost = DPP of non-void spend. OpEx = spend with no project. Payroll not included.',
  }
}

// ------------------------------------------------------------------ read-only SQL for the agent

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|begin|commit|rollback|savepoint)\b/i

/** Runs one read-only SELECT. The users table (password hashes) cannot be read. */
export async function readonlyQuery(d1: D1Database, query: string, limit = 500) {
  const q = query.trim().replace(/;\s*$/, '')
  if (!/^(select|with)\b/i.test(q)) throw new FinanceError('only SELECT / WITH queries are allowed')
  if (q.includes(';')) throw new FinanceError('one statement only')
  if (FORBIDDEN.test(q)) throw new FinanceError('read-only: that keyword is not allowed')
  if (/\busers\b|password_hash|sqlite_master|_cf_/i.test(q)) throw new FinanceError('that table is not readable')
  const { results } = await d1.prepare(`select * from (${q}) limit ${Math.min(limit, 1000)}`).all()
  return results
}

// ------------------------------------------------------------------ payroll (Employee OpEx)

/** Monthly payroll totals per division for a year, plus year totals. Cost = net + BPJS TK + BPJS Kes + PPh 21. */
export async function payrollSummary(db: Db, year: number) {
  const rows = await db
    .select({
      period: payrollMonths.period,
      division: divisions.name,
      netSalary: payrollMonths.netSalary,
      bpjsTk: payrollMonths.bpjsTk,
      bpjsKes: payrollMonths.bpjsKes,
      pph21: payrollMonths.pph21,
      headcount: payrollMonths.headcount,
    })
    .from(payrollMonths)
    .innerJoin(divisions, eq(divisions.id, payrollMonths.divisionId))
    .where(sql`${payrollMonths.period} like ${year + '-%'}`)
    .orderBy(asc(payrollMonths.period), asc(divisions.id))
  const sum = (k: 'netSalary' | 'bpjsTk' | 'bpjsKes' | 'pph21') => rows.reduce((a, r) => a + r[k], 0)
  return {
    year,
    totals: {
      netSalary: sum('netSalary'),
      bpjsTk: sum('bpjsTk'),
      bpjsKes: sum('bpjsKes'),
      pph21: sum('pph21'),
      cost: sum('netSalary') + sum('bpjsTk') + sum('bpjsKes') + sum('pph21'),
    },
    rows: rows.map((r) => ({ ...r, cost: r.netSalary + r.bpjsTk + r.bpjsKes + r.pph21 })),
  }
}

/** Saves one month's payroll totals for one division (replaces an existing entry for that month + division). */
export async function recordPayroll(
  db: Db,
  actor: Actor,
  input: {
    period: string
    divisionId: number
    netSalary: number
    bpjsTk?: number
    bpjsKes?: number
    pph21?: number
    headcount?: number
    notes?: string
  },
) {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new FinanceError('period must be YYYY-MM')
  const values = {
    period: input.period,
    divisionId: input.divisionId,
    netSalary: Math.round(input.netSalary),
    bpjsTk: Math.round(input.bpjsTk ?? 0),
    bpjsKes: Math.round(input.bpjsKes ?? 0),
    pph21: Math.round(input.pph21 ?? 0),
    headcount: input.headcount ?? null,
    notes: input.notes ?? null,
  }
  const [row] = await db
    .insert(payrollMonths)
    .values(values)
    .onConflictDoUpdate({ target: [payrollMonths.period, payrollMonths.divisionId], set: values })
    .returning()
  await log(db, actor, 'upsert', 'payroll_months', row.id, values)
  return row
}

// ------------------------------------------------------------------ documents (R2)

const MAX_DOC_BYTES = 15 * 1024 * 1024
type DocEntity = (typeof documents.$inferSelect)['entity']

/** Stores a file in R2 and records it against a transaction, party or project. Returns the document with its URL. */
export async function attachDocument(
  db: Db,
  bucket: R2Bucket,
  actor: Actor,
  appUrl: string,
  input: { entity: DocEntity; entityId: number; filename: string; contentType: string; bytes: ArrayBuffer; kind?: string | null },
) {
  if (input.bytes.byteLength === 0) throw new FinanceError('file is empty')
  if (input.bytes.byteLength > MAX_DOC_BYTES) throw new FinanceError('file is larger than 15 MB')
  const table = input.entity === 'transaction' ? transactions : input.entity === 'party' ? parties : projects
  const exists = await db.select({ id: table.id }).from(table).where(eq(table.id, input.entityId)).get()
  if (!exists) throw new FinanceError(`${input.entity} ${input.entityId} not found`)
  const safeName = input.filename.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file'
  const r2Key = `${input.entity}/${input.entityId}/${Date.now()}-${safeName}`
  await bucket.put(r2Key, input.bytes, { httpMetadata: { contentType: input.contentType } })
  const [row] = await db
    .insert(documents)
    .values({
      entity: input.entity,
      entityId: input.entityId,
      kind: input.kind ?? null,
      r2Key,
      filename: input.filename,
      contentType: input.contentType,
      size: input.bytes.byteLength,
      uploadedBy: actor,
    })
    .returning()
  const url = `${appUrl}/files/${row.id}`
  if (input.entity === 'transaction')
    await db
      .update(transactions)
      .set({ attachmentUrl: url })
      .where(and(eq(transactions.id, input.entityId), sql`${transactions.attachmentUrl} is null`))
  await log(db, actor, 'create', 'documents', row.id, { entity: input.entity, entityId: input.entityId, filename: input.filename })
  return { ...row, url }
}

export async function listDocuments(db: Db, appUrl: string, entity: DocEntity, entityId: number) {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.entity, entity), eq(documents.entityId, entityId)))
    .orderBy(desc(documents.id))
  return rows.map((r) => ({ ...r, url: `${appUrl}/files/${r.id}` }))
}

export async function getDocument(db: Db, id: number) {
  return db.select().from(documents).where(eq(documents.id, id)).get()
}

// ------------------------------------------------------------ users (web app sign-in)

type Role = (typeof USER_ROLES)[number]
const userColumns = { id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt }

/** A random one-time password, shown once to the person who asked. */
export function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

async function findUser(db: Db, ref: string | number) {
  const row = await db
    .select(userColumns)
    .from(users)
    .where(typeof ref === 'number' ? eq(users.id, ref) : sql`lower(${users.email}) = lower(${ref})`)
    .get()
  if (!row) throw new FinanceError(`no user ${ref}`)
  return row
}

async function ownerCount(db: Db) {
  const r = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.role, 'owner'))
    .get()
  return r?.n ?? 0
}

export function listUsers(db: Db) {
  return db.select(userColumns).from(users).orderBy(asc(users.createdAt))
}

export async function addUser(db: Db, actor: Actor, input: { email: string; name: string; role: Role }) {
  const email = input.email.trim().toLowerCase()
  if (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get())
    throw new FinanceError('that email already has an account')
  const password = temporaryPassword()
  const [row] = await db
    .insert(users)
    .values({ email, name: input.name.trim(), role: input.role, passwordHash: await hashPassword(password) })
    .returning(userColumns)
  await log(db, actor, 'create', 'users', row.id, { email, role: input.role })
  return { user: row, temporaryPassword: password }
}

export async function setUserRole(db: Db, actor: Actor, ref: string | number, role: Role) {
  const u = await findUser(db, ref)
  if (u.role === 'owner' && role !== 'owner' && (await ownerCount(db)) <= 1) throw new FinanceError('cannot remove the last owner')
  const [row] = await db.update(users).set({ role }).where(eq(users.id, u.id)).returning(userColumns)
  await log(db, actor, 'update', 'users', u.id, { role })
  return row
}

export async function resetUserPassword(db: Db, actor: Actor, ref: string | number) {
  const u = await findUser(db, ref)
  const password = temporaryPassword()
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, u.id))
  await log(db, actor, 'reset_password', 'users', u.id, { email: u.email })
  return { user: u, temporaryPassword: password }
}

export async function removeUser(db: Db, actor: Actor, ref: string | number) {
  const u = await findUser(db, ref)
  if (u.role === 'owner' && (await ownerCount(db)) <= 1) throw new FinanceError('cannot remove the last owner')
  await db.update(transactions).set({ createdBy: null }).where(eq(transactions.createdBy, u.id))
  await db.update(payments).set({ createdBy: null }).where(eq(payments.createdBy, u.id))
  await db.delete(users).where(eq(users.id, u.id))
  await log(db, actor, 'delete', 'users', u.id, { email: u.email, role: u.role })
  return { removed: u.email }
}
