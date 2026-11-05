/**
 * Finance operations shared by the web UI and the MCP server.
 * Every write goes through here so tax math, budget checks and the activity log
 * are the same no matter who calls.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

import {
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
    if (!line || line.projectId !== project?.id) throw new FinanceError('budget line does not belong to this project')
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

  let approval: typeof approvals.$inferSelect | null = null
  if (row.direction === 'out' && row.status === 'draft') {
    approval = await requestApproval(db, actor, {
      entity: 'transaction',
      entityId: row.id,
      amount: row.total,
      summary: spendSummary(row, input.partyName || null, project?.code ?? null),
    })
  }

  let warning: string | null = project?.status === 'draft' ? `Project ${project.code} budget is not approved yet.` : null
  if (row.budgetLineId && project) {
    const budget = await projectBudget(db, project.id)
    const line = budget.lines.find((l) => l.id === row.budgetLineId)
    if (line && line.actual > line.ceiling)
      warning =
        (warning ? warning + ' ' : '') +
        `Budget line "${line.name}" is now over its ceiling: spent Rp ${line.actual.toLocaleString('id-ID')} of Rp ${line.ceiling.toLocaleString('id-ID')}.`
  }
  return { transaction: row, warning, approval }
}

export async function setTransactionStatus(db: Db, actor: Actor, id: number, status: TransactionStatus) {
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
export async function decideApproval(db: Db, actor: Actor, id: number, decision: 'approve' | 'reject', note?: string) {
  const a = await db.select().from(approvals).where(eq(approvals.id, id)).get()
  if (!a) throw new FinanceError(`approval ${id} not found`)
  if (a.status !== 'pending') throw new FinanceError(`approval ${id} is already ${a.status} by ${a.decidedBy}`)
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
 * Payroll is not included (payroll_months is owner/hr only).
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
