/**
 * Finance operations shared by the web UI and the MCP server.
 * Every write goes through here so tax math, budget checks and the activity log
 * are the same no matter who calls.
 */
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm'

import {
  accounts,
  documents,
  openingBalances,
  employees,
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
  type TAX_TYPES,
} from '#/db/schema'
import { hashPassword } from '#/lib/auth'
import type { ListFilter } from '#/lib/filters'
import { auditSource, type Db } from '#/lib/db'
import { cleanClientCode, suggestClientCode } from '#/lib/client-code'
import { computeTax, type PphType } from '#/lib/tax'

export { cleanClientCode, suggestClientCode }

export type Actor = string
export type TransactionKind = (typeof TRANSACTION_KINDS)[number]
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number]
export type PartyKind = (typeof PARTY_KINDS)[number]

export class FinanceError extends Error {}

const today = () => new Date().toISOString().slice(0, 10)
/** Today's date in Jakarta (WIB), for codes people read. */
const todayWib = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
const addDays = (date: string, days: number) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400_000).toISOString().slice(0, 10)

/** Writes one audit row. Source (web / mcp / import) and import batch come from the Db handle. */
export async function log(db: Db, actor: Actor, action: string, entity: string, entityId: number, data?: unknown) {
  const { source, batchId } = auditSource(db)
  await db.insert(activityLog).values({ actor, action, entity, entityId, data: data ?? null, source, batchId: batchId ?? null })
}

/** The audit log, newest first, for the Logs page. */
export async function listActivity(
  db: Db,
  f: { entity?: string; source?: 'web' | 'mcp' | 'import'; actor?: string; batchId?: string; before?: number; limit?: number } = {},
) {
  const where = and(
    f.entity ? eq(activityLog.entity, f.entity) : undefined,
    f.source ? eq(activityLog.source, f.source) : undefined,
    f.actor ? sql`lower(${activityLog.actor}) like ${'%' + f.actor.toLowerCase() + '%'}` : undefined,
    f.batchId ? eq(activityLog.batchId, f.batchId) : undefined,
    f.before ? lt(activityLog.id, f.before) : undefined,
  )
  return db
    .select()
    .from(activityLog)
    .where(where)
    .orderBy(desc(activityLog.id))
    .limit(f.limit ?? 100)
}

// ------------------------------------------------------------------ lookups

export async function listCompanies(db: Db) {
  return db.select().from(companies).orderBy(asc(companies.name))
}

export async function listDivisions(db: Db) {
  return db
    .select({
      id: divisions.id,
      name: divisions.name,
      companyId: divisions.companyId,
      company: companies.name,
      bankName: divisions.bankName,
      bankAccountNumber: divisions.bankAccountNumber,
      bankAccountName: divisions.bankAccountName,
      hasLogo: sql<number>`${divisions.logo} is not null`,
    })
    .from(divisions)
    .innerJoin(companies, eq(companies.id, divisions.companyId))
    .orderBy(asc(divisions.name))
}

/** Adds a PT. Divisions (agencies) are added under it with createDivision. */
export async function createCompany(db: Db, actor: Actor, input: { name: string; code?: string | null; npwp?: string | null; address?: string | null }) {
  const name = input.name.trim()
  if (!name) throw new FinanceError('PT name is empty')
  if (await db.select().from(companies).where(sql`lower(${companies.name}) = lower(${name})`).get()) throw new FinanceError(`${name} already exists`)
  const [row] = await db
    .insert(companies)
    .values({ name, code: input.code?.trim().toUpperCase() || null, npwp: input.npwp?.trim() || null, address: input.address?.trim() || null })
    .returning()
  await log(db, actor, 'create', 'companies', row.id, row)
  return row
}

export async function updateCompany(
  db: Db,
  actor: Actor,
  id: number,
  input: { name?: string; code?: string | null; npwp?: string | null; address?: string | null },
) {
  const set: Partial<typeof companies.$inferInsert> = {}
  if (input.name !== undefined) set.name = input.name.trim()
  if (input.code !== undefined) set.code = input.code?.trim().toUpperCase() || null
  if (input.npwp !== undefined) set.npwp = input.npwp?.trim() || null
  if (input.address !== undefined) set.address = input.address?.trim() || null
  const [row] = await db.update(companies).set(set).where(eq(companies.id, id)).returning()
  if (!row) throw new FinanceError(`company ${id} not found`)
  await log(db, actor, 'update', 'companies', id, set)
  return row
}

/** Adds a division (agency / brand) under a PT. Names are unique across all PTs. */
export async function createDivision(db: Db, actor: Actor, input: { companyId: number; name: string }) {
  const name = input.name.trim()
  if (!name) throw new FinanceError('division name is empty')
  if (!(await db.select().from(companies).where(eq(companies.id, input.companyId)).get())) throw new FinanceError(`company ${input.companyId} not found`)
  if (await db.select().from(divisions).where(sql`lower(${divisions.name}) = lower(${name})`).get()) throw new FinanceError(`division ${name} already exists`)
  const [row] = await db.insert(divisions).values({ companyId: input.companyId, name }).returning()
  await log(db, actor, 'create', 'divisions', row.id, row)
  return row
}

/** Renames a division or moves it to another PT. A division with projects can't move: its projects' history belongs to the old PT. */
export async function updateDivision(
  db: Db,
  actor: Actor,
  id: number,
  input: {
    name?: string
    companyId?: number
    bankName?: string | null
    bankAccountNumber?: string | null
    bankAccountName?: string | null
    /** data: URL of the logo; null removes it. */
    logo?: string | null
  },
) {
  const d = await db.select().from(divisions).where(eq(divisions.id, id)).get()
  if (!d) throw new FinanceError(`division ${id} not found`)
  const set: Partial<typeof divisions.$inferInsert> = {}
  if (input.name?.trim()) set.name = input.name.trim()
  for (const k of ['bankName', 'bankAccountNumber', 'bankAccountName'] as const) if (input[k] !== undefined) set[k] = input[k]?.trim() || null
  if (input.logo !== undefined) {
    if (input.logo && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(input.logo)) throw new FinanceError('logo must be a PNG, JPEG, WebP or SVG image')
    if (input.logo && input.logo.length > 400_000) throw new FinanceError('logo is too big; use an image under 300 KB')
    set.logo = input.logo || null
  }
  if (input.companyId && input.companyId !== d.companyId) {
    const used = await db.select({ id: projects.id }).from(projects).where(eq(projects.divisionId, id)).get()
    if (used) throw new FinanceError(`division ${d.name} already has projects; add a new division under the other PT instead`)
    set.companyId = input.companyId
  }
  if (!Object.keys(set).length) return d
  const [row] = await db.update(divisions).set(set).where(eq(divisions.id, id)).returning()
  await log(db, actor, 'update', 'divisions', id, set.logo ? { ...set, logo: '(image)' } : set)
  return row
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

/** A vendor from the vendor list, by exact name (case-insensitive). Vendor invoices must use a listed vendor. Never creates one. */
export async function findVendor(db: Db, name: string) {
  const clean = name.trim()
  const found = await db
    .select()
    .from(parties)
    .where(and(eq(parties.kind, 'vendor'), sql`lower(${parties.name}) = lower(${clean})`))
    .get()
  if (!found) throw new FinanceError(`vendor "${clean}" is not in the vendor list. Add it to the Vendor List first (create_party, kind vendor).`)
  return found
}

/** A client from the client list, by id or exact name (case-insensitive). Never creates one. */
export async function findClient(db: Db, ref: { clientId?: number | null; clientName?: string | null }) {
  const row = ref.clientId
    ? await db.select().from(parties).where(and(eq(parties.id, ref.clientId), eq(parties.kind, 'client'))).get()
    : ref.clientName?.trim()
      ? await db
          .select()
          .from(parties)
          .where(and(eq(parties.kind, 'client'), sql`lower(${parties.name}) = lower(${ref.clientName.trim()})`))
          .get()
      : undefined
  if (!row) throw new FinanceError(`client ${ref.clientId ?? ref.clientName ?? ''} is not in the client list. Add it there first.`)
  return row
}

/**
 * Next project code: 2-digit year + client initials + 2-digit month + 2-digit day, no separator
 * (Sagacita on 17 Nov 2026 -> 26SGC1117). A second project for the same client on the same day gets B, then C, ...
 */
export async function nextProjectCode(db: Db, clientId: number, date = todayWib()) {
  const client = await findClient(db, { clientId })
  const initials = client.code || suggestClientCode(client.name)
  const [y, m, d] = date.split('-')
  const base = `${y.slice(2)}${initials}${m}${d}`
  const taken = new Set(
    (await db.select({ code: projects.code }).from(projects).where(sql`upper(${projects.code}) like ${base + '%'}`)).map((r) =>
      r.code.toUpperCase(),
    ),
  )
  if (!taken.has(base)) return base
  for (let i = 1; i < 26; i++) {
    const c = base + String.fromCharCode(65 + i)
    if (!taken.has(c)) return c
  }
  throw new FinanceError('too many projects for this client today')
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

/**
 * Projects with budget totals (lifetime of each project), optionally filtered.
 * A date range keeps projects whose period overlaps it (no dates = always kept).
 * Totals come from three grouped queries, not one set per project.
 */
export async function listProjects(db: Db, f: ListFilter = {}) {
  const where = [
    f.divisionId ? eq(projects.divisionId, f.divisionId) : undefined,
    f.clientId ? eq(projects.clientId, f.clientId) : undefined,
    f.projectCode ? eq(projects.code, f.projectCode) : undefined,
    f.projectStatus ? eq(projects.status, f.projectStatus) : undefined,
    f.to ? sql`(${projects.startDate} is null or ${projects.startDate} <= ${f.to})` : undefined,
    f.from ? sql`(coalesce(${projects.endDate}, ${projects.startDate}) is null or coalesce(${projects.endDate}, ${projects.startDate}) >= ${f.from})` : undefined,
  ].filter((w) => w !== undefined)
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
      clientId: projects.clientId,
      division: divisions.name,
      divisionId: projects.divisionId,
    })
    .from(projects)
    .innerJoin(parties, eq(parties.id, projects.clientId))
    .innerJoin(divisions, eq(divisions.id, projects.divisionId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(projects.code))
  if (!rows.length) return []
  const totals = await projectTotals(db)
  return rows.map((p) => ({ ...p, totals: totals(p.id) }))
}

/** Budget totals for every project at once (same numbers as projectBudget(...).totals). */
async function projectTotals(db: Db) {
  const [lines, spend, billed] = await Promise.all([
    db
      .select({ id: budgetLines.id, projectId: budgetLines.projectId, charge: budgetLines.charge, maxExpense: budgetLines.maxExpense, asf: budgetLines.asfAmount })
      .from(budgetLines),
    db
      .select({ projectId: transactions.projectId, lineId: transactions.budgetLineId, v: sql<number>`coalesce(sum(${transactions.dpp}), 0)` })
      .from(transactions)
      .where(and(sql`${transactions.projectId} is not null`, eq(transactions.direction, 'out'), sql`${transactions.status} != 'void'`))
      .groupBy(transactions.projectId, transactions.budgetLineId),
    db
      .select({ projectId: transactions.projectId, v: sql<number>`coalesce(sum(${transactions.dpp}), 0)` })
      .from(transactions)
      .where(and(sql`${transactions.projectId} is not null`, eq(transactions.direction, 'in'), sql`${transactions.status} != 'void'`))
      .groupBy(transactions.projectId),
  ])
  const spendBy = new Map(spend.map((s) => [`${s.projectId}:${s.lineId}`, Number(s.v)]))
  const billedBy = new Map(billed.map((b) => [b.projectId, Number(b.v)]))
  const linesBy = new Map<number, typeof lines>()
  for (const l of lines) linesBy.set(l.projectId, [...(linesBy.get(l.projectId) ?? []), l])
  return (projectId: number) => {
    let charge = 0, asf = 0, ceiling = 0, actual = 0
    for (const l of linesBy.get(projectId) ?? []) {
      charge += l.charge
      asf += l.asf
      ceiling += l.maxExpense + l.asf
      actual += spendBy.get(`${projectId}:${l.id}`) ?? 0
    }
    const unbudgeted = spendBy.get(`${projectId}:null`) ?? 0
    actual += unbudgeted
    return {
      charge,
      asf,
      ceiling,
      actual,
      unbudgeted,
      remaining: ceiling - actual,
      usedPct: ceiling ? Math.round((actual / ceiling) * 1000) / 10 : 0,
      actualMargin: charge - actual,
      billed: billedBy.get(projectId) ?? 0,
    }
  }
}

export async function createProject(
  db: Db,
  actor: Actor,
  input: {
    /** Omit to generate one (see nextProjectCode). */
    code?: string | null
    name: string
    clientId?: number | null
    clientName?: string | null
    divisionId: number
    type: (typeof PROJECT_TYPES)[number]
    startDate?: string
    endDate?: string
    contractValue?: number | null
  },
) {
  const client = await findClient(db, input)
  const code = input.code?.trim() || (await nextProjectCode(db, client.id))
  const [row] = await db
    .insert(projects)
    .values({
      code,
      name: input.name.trim(),
      clientId: client.id,
      divisionId: input.divisionId,
      type: input.type,
      status: 'draft',
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      contractValue: input.contractValue == null ? null : Math.round(input.contractValue),
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
    clientId?: number
    clientName?: string
    divisionId?: number
    type?: (typeof PROJECT_TYPES)[number]
    startDate?: string | null
    endDate?: string | null
    contractValue?: number | null
  },
) {
  const set: Partial<typeof projects.$inferInsert> = {}
  if (input.code) set.code = input.code.trim()
  if (input.name) set.name = input.name.trim()
  if (input.clientId || input.clientName) set.clientId = (await findClient(db, input)).id
  if (input.divisionId) set.divisionId = input.divisionId
  if (input.type) set.type = input.type
  if (input.startDate !== undefined) set.startDate = input.startDate || null
  if (input.endDate !== undefined) set.endDate = input.endDate || null
  if (input.contractValue !== undefined) {
    if (input.contractValue != null && !(input.contractValue >= 0)) throw new FinanceError('contract value must be 0 or more')
    set.contractValue = input.contractValue == null ? null : Math.round(input.contractValue)
  }
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

export type PartyDetails = {
  name?: string
  legalEntity?: string | null
  code?: string | null
  address?: string | null
  paymentTermsDays?: number | null
  npwp?: string | null
  picName?: string | null
  phone?: string | null
  email?: string | null
  bankName?: string | null
  accountName?: string | null
  bankAccount?: string | null
  notes?: string | null
}

/** Update a client / vendor / employee: brand name, PT entity, code, address, TOP, NPWP, bank account, notes. */
export async function updateParty(db: Db, actor: Actor, id: number, input: PartyDetails) {
  const set: Partial<typeof parties.$inferInsert> = {}
  if (input.name) set.name = input.name.trim()
  for (const k of ['legalEntity', 'address', 'npwp', 'picName', 'phone', 'email', 'bankName', 'accountName', 'bankAccount', 'notes'] as const)
    if (input[k] !== undefined) set[k] = input[k]?.trim() || null
  if (input.code !== undefined) {
    try {
      set.code = cleanClientCode(input.code)
    } catch (e) {
      throw new FinanceError((e as Error).message)
    }
  }
  if (input.paymentTermsDays !== undefined)
    set.paymentTermsDays = input.paymentTermsDays == null || Number.isNaN(input.paymentTermsDays) ? null : Math.max(0, Math.round(input.paymentTermsDays))
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
  /** Chart of accounts line. Client invoices default to the Billing (revenue) account. */
  accountId?: number | null
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
  const issueDate = input.issueDate || today()
  let dueDate = input.dueDate || null

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
    partyId = (input.kind === 'vendor_bill' ? await findVendor(db, input.partyName) : await ensureParty(db, actor, kind, input.partyName)).id
  }
  // Client invoices default their due date to the client's standard TOP.
  if (direction === 'in' && !dueDate && partyId) {
    const top = (await db.select({ d: parties.paymentTermsDays }).from(parties).where(eq(parties.id, partyId)).get())?.d
    if (top != null) dueDate = addDays(issueDate, top)
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
      // Client invoices keep their own division: it picks the bank and logo printed on the invoice. Reports still use the project's.
      divisionId: project && direction !== 'in' ? null : (input.divisionId ?? null),
      category: input.category || null,
      accountId: input.accountId ?? (direction === 'in' ? await defaultRevenueAccount(db) : null),
      description: input.description || null,
      issueDate,
      dueDate,
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
  if (status === 'settled') throw new FinanceError('a cash advance is settled by its LPJ: use settle_advance with what was actually spent')
  if (status !== 'draft' && status !== 'void') {
    const pending = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.entity, 'transaction'), eq(approvals.entityId, id), eq(approvals.status, 'pending')))
      .get()
    if (pending)
      throw new FinanceError(
        `this expense is waiting in Approvals (#${pending.id}): Finance acknowledges and sets a pay date, then BOD releases it`,
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

/** Net cash moved for a transaction: payments in its own direction minus refunds the other way. */
async function paidSoFar(db: Db, transactionId: number, direction?: 'in' | 'out') {
  const dir = direction ?? (await db.select({ d: transactions.direction }).from(transactions).where(eq(transactions.id, transactionId)).get())?.d
  const r = await db
    .select({ paid: sql<number>`coalesce(sum(case when ${payments.direction} = ${dir} then ${payments.amount} else -${payments.amount} end), 0)` })
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
  const outstanding = tx.total - (await paidSoFar(db, tx.id, tx.direction))
  // A negative outstanding (settlement where less was spent than advanced) is a refund: cash moving the other way.
  const refund = outstanding < 0
  const open = Math.abs(outstanding)
  const amount = Math.round(input.amount ?? open)
  if (amount <= 0 || open === 0) throw new FinanceError('nothing outstanding on this transaction')
  if (amount > open) throw new FinanceError(`amount ${amount} is more than the outstanding ${open}`)
  const [row] = await db
    .insert(payments)
    .values({
      transactionId: tx.id,
      direction: refund ? (tx.direction === 'in' ? 'out' : 'in') : tx.direction,
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
  return { payment: row, outstanding: refund ? outstanding + amount : outstanding - amount }
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
    /** Client invoices only: the division whose bank and logo go on the invoice. */
    divisionId?: number | null
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
    const party = tx.kind === 'vendor_bill' ? await findVendor(db, input.partyName) : await ensureParty(db, actor, kind, input.partyName)
    set.partyId = party.id
    partyName = party.name
  }
  if (input.divisionId !== undefined && tx.direction === 'in') set.divisionId = input.divisionId
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

// ------------------------------------------------------------------ advance settlement (LPJ)

export type SettlementLine = { projectId?: number | null; amount: number; description?: string | null; accountId?: number | null }

/**
 * Closes a paid cash advance with its LPJ (settlement report): what was really spent, per project.
 * Writes one settlement row per line (dpp = spent, total 0: the advance already paid it) and one balance row
 * (dpp = -advance so the advance stops counting as cost; total = spent - advance). A positive balance is
 * still owed to the person (pay it like any bill); a negative one is a refund owed back (record_payment
 * records it as cash in). The advance becomes "settled". Receipts go on the advance with attach_document.
 */
export async function settleAdvance(
  db: Db,
  actor: Actor,
  input: { advanceId: number; lines: SettlementLine[]; date?: string; number?: string | null; note?: string | null; createdBy?: number | null },
) {
  const adv = await db.select().from(transactions).where(eq(transactions.id, input.advanceId)).get()
  if (!adv || adv.kind !== 'cash_advance') throw new FinanceError(`cash advance ${input.advanceId} not found`)
  if (adv.status === 'settled') throw new FinanceError(`cash advance ${adv.id} is already settled`)
  if (adv.status !== 'approved') throw new FinanceError(`cash advance ${adv.id} is ${adv.status}; only an approved, paid advance can be settled`)
  const paid = await paidSoFar(db, adv.id, 'out')
  if (paid < adv.total) throw new FinanceError(`cash advance ${adv.id} is not fully paid yet (paid ${paid} of ${adv.total})`)
  const lines = input.lines.filter((l) => Math.round(l.amount) !== 0)
  if (!lines.length) throw new FinanceError('give at least one line with the amount actually spent')
  const date = input.date || today()
  const spent = lines.reduce((a, l) => a + Math.round(l.amount), 0)
  const balance = spent - adv.total
  const base = {
    kind: 'settlement' as const,
    direction: 'out' as const,
    status: 'approved' as const,
    number: input.number || null,
    companyId: adv.companyId,
    partyId: adv.partyId,
    advanceId: adv.id,
    accountId: adv.accountId,
    issueDate: date,
    requestedBy: adv.requestedBy,
    source: auditSource(db).source === 'import' ? ('import' as const) : ('web' as const),
    createdBy: input.createdBy ?? null,
  }
  const rows: (typeof transactions.$inferSelect)[] = []
  for (const l of lines) {
    let projectId = adv.projectId
    let divisionId = adv.divisionId
    if (l.projectId !== undefined) {
      projectId = l.projectId ? (await findProject(db, l.projectId)).id : null
      divisionId = projectId ? null : adv.divisionId
    }
    const amount = Math.round(l.amount)
    const [row] = await db
      .insert(transactions)
      .values({
        ...base,
        projectId,
        divisionId,
        category: projectId ? null : adv.category,
        accountId: l.accountId ?? adv.accountId,
        description: l.description || `LPJ ${adv.number ?? '#' + adv.id}: spent`,
        dpp: amount,
        total: 0,
      })
      .returning()
    await log(db, actor, 'create', 'transactions', row.id, row)
    rows.push(row)
  }
  const what = balance > 0 ? `Rp ${balance.toLocaleString('id-ID')} still to pay` : balance < 0 ? `Rp ${(-balance).toLocaleString('id-ID')} to refund` : 'no difference'
  const [bal] = await db
    .insert(transactions)
    .values({
      ...base,
      projectId: adv.projectId,
      divisionId: adv.divisionId,
      budgetLineId: adv.budgetLineId,
      category: adv.category,
      description: `LPJ ${adv.number ?? '#' + adv.id}: spent Rp ${spent.toLocaleString('id-ID')} of Rp ${adv.total.toLocaleString('id-ID')} advanced, ${what}${input.note ? ' · ' + input.note : ''}`,
      dueDate: balance !== 0 ? date : null,
      dpp: -adv.dpp,
      total: balance,
    })
    .returning()
  await log(db, actor, 'create', 'transactions', bal.id, bal)
  await db.update(transactions).set({ status: 'settled', updatedAt: new Date().toISOString() }).where(eq(transactions.id, adv.id))
  await log(db, actor, 'update', 'transactions', adv.id, { status: 'settled', settledBy: bal.id })
  return { advance: { ...adv, status: 'settled' as const }, lines: rows, balance: bal, spent, difference: balance }
}

// ------------------------------------------------------------------ chart of accounts (COA) and P&L

export async function listAccounts(db: Db) {
  return db.select().from(accounts).orderBy(asc(accounts.sortOrder))
}

async function defaultRevenueAccount(db: Db) {
  return (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.group, 'revenue')).orderBy(asc(accounts.sortOrder)).get())?.id ?? null
}

/** Sets the COA line on one or more transactions (any status; it only changes how the P&L groups them). */
export const MEDICAL_TYPES = ['Outpatient', 'Inpatient', 'Dental', 'Vision'] as const

/** Medical claims used this year per employee: approved (counts against the allowance) and still waiting approval. */
export async function medicalUsage(d1: D1Database, year: number, employeeName?: string) {
  const { results } = await d1
    .prepare(
      `select party, sum(case when status != 'draft' then dpp else 0 end) used, sum(case when status = 'draft' then dpp else 0 end) pending
       from v_transactions where kind = 'reimbursement' and status != 'void' and (category like 'Medical%' or account like 'Medical%')
         and substr(issue_date, 1, 4) = ? ${employeeName ? 'and party = ?' : ''} group by party`,
    )
    .bind(...(employeeName ? [String(year), employeeName] : [String(year)]))
    .all<{ party: string; used: number; pending: number }>()
  return results
}

/**
 * HR files an employee's medical claim: a reimbursement to that employee on the Medical COA account, with no project.
 * It then follows the normal expense flow (approval, payment run).
 */
export async function recordMedicalClaim(
  db: Db,
  actor: Actor,
  input: { employeeId: number; amount: number; type?: string | null; date?: string; description?: string | null; attachmentUrl?: string | null; createdBy?: number | null; source?: 'web' | 'whatsapp' },
) {
  const emp = await db.select().from(employees).where(eq(employees.id, input.employeeId)).get()
  if (!emp) throw new FinanceError(`employee ${input.employeeId} not found`)
  const company = emp.divisionId
    ? (await db.select().from(divisions).where(eq(divisions.id, emp.divisionId)).get())?.companyId
    : (await db.select().from(companies).orderBy(asc(companies.id)).get())?.id
  const account = await db.select().from(accounts).where(sql`lower(${accounts.name}) like 'medical%'`).get()
  if (emp.medicalLimit != null) {
    const year = Number((input.date || today()).slice(0, 4))
    const u = await db
      .select({ v: sql<number>`coalesce(sum(${transactions.dpp}), 0)` })
      .from(transactions)
      .innerJoin(parties, eq(parties.id, transactions.partyId))
      .where(
        and(
          eq(transactions.kind, 'reimbursement'),
          sql`${transactions.status} != 'void'`,
          sql`(${transactions.category} like 'Medical%' or ${transactions.accountId} = ${account?.id ?? -1})`,
          sql`substr(${transactions.issueDate}, 1, 4) = ${String(year)}`,
          eq(parties.name, emp.name),
        ),
      )
      .get()
    const left = emp.medicalLimit - (u?.v ?? 0)
    if (Math.round(input.amount) > left)
      throw new FinanceError(`${emp.name} has Rp ${Math.max(left, 0).toLocaleString('id-ID')} medical balance left for ${year} (limit Rp ${emp.medicalLimit.toLocaleString('id-ID')})`)
  }
  const type = input.type?.trim() || 'Outpatient'
  return recordTransaction(db, actor, {
    kind: 'reimbursement',
    companyId: company ?? null,
    divisionId: emp.divisionId,
    partyName: emp.name,
    accountId: account?.id ?? null,
    category: `Medical: ${type}`,
    description: `Medical claim (${type}): ${input.description?.trim() || emp.name}`,
    issueDate: input.date,
    dpp: input.amount,
    withPpn: false,
    pphType: 'none',
    requestedBy: emp.name,
    attachmentUrl: input.attachmentUrl ?? null,
    source: input.source ?? 'web',
    createdBy: input.createdBy ?? null,
  })
}

/**
 * Finance tax's step on a client invoice: enter Billing (DPP) and Tax (PPN), with an optional note.
 * Account receivable = billing + tax (minus PPh the client withholds, if any). The invoice then counts as sent.
 */
export async function inputInvoiceTax(db: Db, actor: Actor, id: number, input: { billing: number; tax: number; note?: string | null }) {
  const t = await db.select().from(transactions).where(eq(transactions.id, id)).get()
  if (!t || t.kind !== 'client_invoice') throw new FinanceError(`invoice ${id} not found`)
  if (t.status === 'void') throw new FinanceError('invoice is void')
  if ((await paidSoFar(db, id)) !== 0) throw new FinanceError('invoice already has payments; its amounts can no longer change')
  const billing = Math.round(input.billing)
  const tax = Math.round(input.tax)
  if (!(billing > 0) || !(tax >= 0)) throw new FinanceError('billing must be more than 0 and tax 0 or more')
  const set = { dpp: billing, ppn: tax, total: billing + tax - t.pph, note: input.note?.trim() || null, status: 'approved' as const, updatedAt: new Date().toISOString() }
  const [row] = await db.update(transactions).set(set).where(eq(transactions.id, id)).returning()
  await log(db, actor, 'update', 'transactions', id, { before: { dpp: t.dpp, ppn: t.ppn, total: t.total, status: t.status, note: t.note }, after: set })
  return { ...row, accountReceivable: row.total }
}

export async function setTransactionAccount(db: Db, actor: Actor, ids: number[], accountRef: number | string | null) {
  let accountId: number | null = null
  if (accountRef != null) {
    const a = await db
      .select()
      .from(accounts)
      .where(typeof accountRef === 'number' ? eq(accounts.id, accountRef) : eq(accounts.code, accountRef))
      .get()
    if (!a) throw new FinanceError(`account ${accountRef} not found; see list_accounts`)
    if (a.group === 'balance') throw new FinanceError(`${a.code} ${a.name} is a balance-sheet account, not a P&L line`)
    accountId = a.id
  }
  let n = 0
  for (const id of ids) {
    const [row] = await db
      .update(transactions)
      .set({ accountId, updatedAt: new Date().toISOString() })
      .where(eq(transactions.id, id))
      .returning({ id: transactions.id })
    if (!row) throw new FinanceError(`transaction ${id} not found`)
    await log(db, actor, 'update', 'transactions', id, { accountId })
    n++
  }
  return { updated: n, accountId }
}

export type PnlLine = { group: string; code: string | null; name: string; amount: number }

/**
 * P&L by chart of accounts for one PT and year, in the statement's order.
 * Revenue and costs = dpp of non-void transactions by account (issue date). Payroll from Employee OpEx goes to
 * the Salary, BPJS and PPh 21 (Employee) accounts. Rows with no account yet show as "Not categorised".
 */
/** P&L by account for a year, or for a filter (date range, division, client, project). */
export async function pnlByAccount(d1: D1Database, companyId: number, yearOrFilter: number | ListFilter) {
  const f: ListFilter = typeof yearOrFilter === 'number' ? { from: `${yearOrFilter}-01-01`, to: `${yearOrFilter}-12-31` } : yearOrFilter
  const where: string[] = []
  const args: unknown[] = [companyId]
  if (f.from) (where.push('t.issue_date >= ?'), args.push(f.from))
  if (f.to) (where.push('t.issue_date <= ?'), args.push(f.to))
  if (f.divisionId) (where.push('coalesce(pr.division_id, t.division_id) = ?'), args.push(f.divisionId))
  if (f.clientId) (where.push('pr.client_id = ?'), args.push(f.clientId))
  if (f.projectCode) (where.push('pr.code = ?'), args.push(f.projectCode))
  const rows = (
    await d1
      .prepare(
        `select a."group" grp, a.code, a.name, a.sort_order so, t.direction, case when t.project_id is null then 0 else 1 end proj, sum(t.dpp) v
         from transactions t left join accounts a on a.id = t.account_id left join projects pr on pr.id = t.project_id
         where t.company_id = ? and t.status != 'void' and t.kind != 'tax_payment'${where.map((w) => ' and ' + w).join('')}
         group by 1, 2, 3, 4, 5, 6 having sum(t.dpp) != 0`,
      )
      .bind(...args)
      .all<{ grp: string | null; code: string | null; name: string | null; so: number | null; direction: string; proj: number; v: number }>()
  ).results
  // Payroll is per division and month, so it follows the range and division but not a client or project filter.
  const pay =
    f.clientId || f.projectCode
      ? null
      : await d1
          .prepare(
            `select coalesce(sum(p.net_salary + p.allowance), 0) salary, coalesce(sum(p.bpjs_tk + p.bpjs_kes), 0) bpjs, coalesce(sum(p.pph21), 0) pph21
             from payroll_months p join divisions d on d.id = p.division_id
             where d.company_id = ? and p.period >= ? and p.period <= ?${f.divisionId ? ' and p.division_id = ?' : ''}`,
          )
          .bind(companyId, f.from?.slice(0, 7) ?? '0000', f.to?.slice(0, 7) ?? '9999', ...(f.divisionId ? [f.divisionId] : []))
          .first<{ salary: number; bpjs: number; pph21: number }>()
  const acc = (
    await d1.prepare(`select code, name, "group" grp, sort_order so from accounts`).all<{ code: string; name: string; grp: string; so: number }>()
  ).results
  const lines = new Map<string, PnlLine & { so: number }>()
  const put = (group: string, code: string | null, name: string, so: number, v: number) => {
    if (!v) return
    const k = group + '|' + (code ?? name)
    const cur = lines.get(k) ?? { group, code, name, amount: 0, so }
    cur.amount += v
    lines.set(k, cur)
  }
  for (const r of rows) {
    if (r.code) put(r.grp!, r.code, r.name!, r.so ?? 0, r.v)
    else if (r.direction === 'in') put('revenue', null, 'Not categorised', 999, r.v)
    else put(r.proj ? 'cost_of_service' : 'operating_expense', null, 'Not categorised', 999, r.v)
  }
  const byName = (re: RegExp) => acc.find((a) => a.grp !== 'balance' && re.test(a.name))
  for (const [re, v] of [
    [/^Salary$/i, pay?.salary ?? 0],
    [/^BPJS Ketenagakerjaan$/i, pay?.bpjs ?? 0],
    [/PPh\s+21 \(Employee\)/i, pay?.pph21 ?? 0],
  ] as const) {
    const a = byName(re)
    if (a && a.grp !== 'balance') put(a.grp, a.code, a.name, a.so, v)
    else put('operating_expense', null, 'Payroll', 998, v)
  }
  const order = ['revenue', 'cost_of_service', 'operating_expense', 'other_income', 'other_expense', 'income_tax']
  const all = [...lines.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.so - b.so)
  const sum = (g: string) => all.filter((l) => l.group === g).reduce((a, l) => a + l.amount, 0)
  const revenue = sum('revenue')
  const cost = sum('cost_of_service')
  const opex = sum('operating_expense')
  const other = sum('other_income') - sum('other_expense')
  const beforeTax = revenue - cost - opex + other
  const tax = sum('income_tax')
  return {
    lines: all.map(({ so: _so, ...l }) => l),
    totals: { revenue, costOfService: cost, grossProfit: revenue - cost, operatingExpenses: opex, operatingProfit: revenue - cost - opex, other, beforeTax, incomeTax: tax, netProfit: beforeTax - tax },
    uncategorised: all.filter((l) => !l.code).reduce((a, l) => a + l.amount, 0),
  }
}

// ------------------------------------------------------------------ balance sheet

export type OpeningBalances = Omit<typeof openingBalances.$inferSelect, 'updatedBy' | 'updatedAt' | 'companyId'>
const OPENING_FIELDS = ['cash', 'receivables', 'otherAssets', 'payables', 'taxPayable', 'otherLiabilities', 'shareCapital', 'retainedEarnings'] as const

/** Saves a PT's opening balance sheet (finance enters it once, e.g. the 31 Dec 2024 closing figures). */
export async function setOpeningBalances(db: Db, actor: Actor, companyId: number, input: OpeningBalances) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new FinanceError('asOf must be a date, YYYY-MM-DD')
  const values = { asOf: input.asOf, ...Object.fromEntries(OPENING_FIELDS.map((k) => [k, Math.round(Number(input[k]) || 0)])) } as OpeningBalances
  const row = { companyId, ...values, updatedBy: actor, updatedAt: new Date().toISOString() }
  const [saved] = await db.insert(openingBalances).values(row).onConflictDoUpdate({ target: openingBalances.companyId, set: row }).returning()
  await log(db, actor, 'update', 'opening_balances', companyId, saved)
  return saved
}

/**
 * Balance sheet of one PT as of a date: the opening balances plus everything recorded after the opening date.
 *   Cash & bank   = opening + money in - money out (payments), minus payroll net salary (taken as paid in its month)
 *   Receivables   = opening + invoices issued - collected
 *   Advances      = paid cash advances with no LPJ yet as of the date
 *   Prepaid tax   = PPh withheld by clients on our invoices
 *   Payables      = opening + bills, reimbursements, LPJ balances and tax deposits issued - paid
 *   Tax payable   = opening + PPN on invoices - PPN on bills + PPh withheld on bills + payroll PPh 21 / BPJS - deposits
 *   Equity        = share capital + opening retained earnings + profit since the opening date (the P&L, with
 *                   advances that have no LPJ yet moved back out of cost, since they still sit in assets)
 * Same rows as the P&L (non-void, by issue date), so it balances when the opening balances do.
 */
export async function balanceSheet(d1: D1Database, companyId: number, asOf: string) {
  const opening = (await d1
    .prepare(
      `select as_of asOf, cash, receivables, other_assets otherAssets, payables, tax_payable taxPayable, other_liabilities otherLiabilities,
              share_capital shareCapital, retained_earnings retainedEarnings, updated_by updatedBy, updated_at updatedAt
       from opening_balances where company_id = ?`,
    )
    .bind(companyId)
    .first<OpeningBalances & { updatedBy: string | null; updatedAt: string | null }>()) ?? {
    asOf: '2024-12-31',
    cash: 0,
    receivables: 0,
    otherAssets: 0,
    payables: 0,
    taxPayable: 0,
    otherLiabilities: 0,
    shareCapital: 0,
    retainedEarnings: 0,
    updatedBy: null,
    updatedAt: null,
  }
  const o = opening.asOf
  const d = asOf < o ? o : asOf
  // Issued in (opening, as of]: totals by kind group.
  const tx = await d1
    .prepare(
      `select case when kind = 'client_invoice' then 'in' when kind = 'cash_advance' then 'adv' when kind = 'tax_payment' then 'tax' else 'out' end g,
              sum(total) total, sum(ppn) ppn, sum(pph) pph
       from transactions where company_id = ? and status != 'void' and issue_date > ? and issue_date <= ? group by 1`,
    )
    .bind(companyId, o, d)
    .all<{ g: string; total: number; ppn: number; pph: number }>()
  const t = (g: string) => tx.results.find((r) => r.g === g) ?? { total: 0, ppn: 0, pph: 0 }
  // Advances issued in range with no LPJ (settlement) dated on or before the as-of date.
  const adv = await d1
    .prepare(
      `select coalesce(sum(a.total), 0) total,
              coalesce(sum((select coalesce(sum(case when y.direction = a.direction then y.amount else -y.amount end), 0)
                             from payments y where y.transaction_id = a.id and y.date > ? and y.date <= ?)), 0) paid
       from transactions a
       where a.company_id = ? and a.kind = 'cash_advance' and a.status != 'void' and a.issue_date > ? and a.issue_date <= ?
         and not exists (select 1 from transactions s where s.advance_id = a.id and s.kind = 'settlement' and s.status != 'void' and s.issue_date <= ?)`,
    )
    .bind(o, d, companyId, o, d, d)
    .first<{ total: number; paid: number }>()
  const unsettled = { total: adv?.total ?? 0, paid: adv?.paid ?? 0 }
  // Payments dated in (opening, as of], any transaction of this PT. Signed against the transaction's direction.
  const pay = await d1
    .prepare(
      `select case when t.kind = 'client_invoice' then 'in' else 'out' end g,
              sum(case when y.direction = 'in' then y.amount else -y.amount end) cash
       from payments y left join transactions t on t.id = y.transaction_id
       where y.company_id = ? and y.date > ? and y.date <= ? group by 1`,
    )
    .bind(companyId, o, d)
    .all<{ g: string; cash: number }>()
  const cashIn = pay.results.find((r) => r.g === 'in')?.cash ?? 0 // collections, net of refunds
  const cashOut = -(pay.results.find((r) => r.g === 'out')?.cash ?? 0) // paid out, net of refunds
  const payroll = await d1
    .prepare(
      `select coalesce(sum(p.net_salary + p.allowance), 0) net, coalesce(sum(p.pph21 + p.bpjs_tk + p.bpjs_kes), 0) tax
       from payroll_months p join divisions dv on dv.id = p.division_id where dv.company_id = ? and p.period > ? and p.period <= ?`,
    )
    .bind(companyId, o.slice(0, 7), d.slice(0, 7))
    .first<{ net: number; tax: number }>()
  const pnl = await pnlByAccount(d1, companyId, { from: nextDay(o), to: d })

  const inv = t('in')
  const out = t('out')
  const tax = t('tax')
  const cash = opening.cash + cashIn - cashOut - (payroll?.net ?? 0)
  const receivables = opening.receivables + inv.total - cashIn
  const advances = unsettled.paid
  const prepaidTax = inv.pph
  // Out-payments include those on advances; the paid part of advances without LPJ is in assets, not payables.
  const payables = opening.payables + out.total + tax.total + (t('adv').total - unsettled.total) - (cashOut - unsettled.paid)
  const taxPayable = opening.taxPayable + inv.ppn - out.ppn + out.pph + (payroll?.tax ?? 0) - tax.total
  const profit = pnl.totals.netProfit + unsettled.total
  const assets = [
    { key: 'cash', label: 'Cash & bank', amount: cash },
    { key: 'receivables', label: 'Accounts receivable (unpaid invoices)', amount: receivables },
    { key: 'advances', label: 'Cash advances without LPJ yet', amount: advances },
    { key: 'prepaidTax', label: 'Prepaid tax (PPh withheld by clients)', amount: prepaidTax },
    { key: 'otherAssets', label: 'Other assets (from opening)', amount: opening.otherAssets },
  ]
  const liabilities = [
    { key: 'payables', label: 'Accounts payable (unpaid bills)', amount: payables },
    { key: 'taxPayable', label: 'Tax & BPJS payable', amount: taxPayable },
    { key: 'otherLiabilities', label: 'Other liabilities (from opening)', amount: opening.otherLiabilities },
  ]
  const equity = [
    { key: 'shareCapital', label: 'Share capital', amount: opening.shareCapital },
    { key: 'retainedEarnings', label: `Retained earnings to ${o}`, amount: opening.retainedEarnings },
    { key: 'profit', label: `Profit ${nextDay(o)} to ${d}`, amount: profit },
  ]
  const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0)
  const totalAssets = sum(assets)
  const totalLiabilities = sum(liabilities)
  const totalEquity = sum(equity)
  const openingGap =
    opening.cash + opening.receivables + opening.otherAssets - (opening.payables + opening.taxPayable + opening.otherLiabilities + opening.shareCapital + opening.retainedEarnings)
  return {
    asOf: d,
    opening,
    assets,
    liabilities,
    equity,
    totals: { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity, difference: totalAssets - totalLiabilities - totalEquity },
    openingGap,
    notes: { pnlNetProfit: pnl.totals.netProfit, advancesWithoutLpj: unsettled.total, payrollNetSalary: payroll?.net ?? 0, uncategorised: pnl.uncategorised },
  }
}

const nextDay = (date: string) => new Date(new Date(date + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)

// ------------------------------------------------------------------ tax payments and tax due

export type TaxType = (typeof TAX_TYPES)[number]
export const TAX_LABEL: Record<TaxType, string> = {
  pph21: 'PPh 21',
  pph23: 'PPh 23',
  pph4_2: 'PPh 4(2) / final',
  pph26: 'PPh 26',
  ppn: 'PPN',
  bpjs_tk: 'BPJS TK',
  bpjs_kes: 'BPJS Kesehatan',
}

/**
 * Records tax deposited to the tax office (or BPJS) for a tax month: a tax_payment transaction (dpp 0, so it is
 * not a cost line twice; the withheld PPh is already inside the vendor bill) plus its payment.
 */
export async function recordTaxPayment(
  db: Db,
  actor: Actor,
  input: {
    companyId: number
    taxType: TaxType
    period: string
    amount: number
    date?: string
    number?: string | null
    description?: string | null
    createdBy?: number | null
  },
) {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new FinanceError('period must be the tax month as YYYY-MM')
  const amount = Math.round(input.amount)
  if (!(amount > 0)) throw new FinanceError('amount must be more than 0')
  if (!(await db.select().from(companies).where(eq(companies.id, input.companyId)).get())) throw new FinanceError(`company ${input.companyId} not found`)
  const date = input.date || today()
  const source = auditSource(db).source === 'import' ? ('import' as const) : ('web' as const)
  const [row] = await db
    .insert(transactions)
    .values({
      kind: 'tax_payment',
      direction: 'out',
      status: 'approved',
      number: input.number || null,
      companyId: input.companyId,
      category: input.taxType,
      taxPeriod: input.period,
      description: input.description || `${TAX_LABEL[input.taxType]} masa ${input.period}`,
      issueDate: date,
      dueDate: date,
      dpp: 0,
      total: amount,
      source,
      createdBy: input.createdBy ?? null,
    })
    .returning()
  await log(db, actor, 'create', 'transactions', row.id, row)
  const [pay] = await db
    .insert(payments)
    .values({ transactionId: row.id, direction: 'out', amount, date, companyId: input.companyId, createdBy: input.createdBy ?? null })
    .returning()
  await log(db, actor, 'pay', 'transactions', row.id, pay)
  return { transaction: row, payment: pay }
}

/** Deposit deadline for a tax month: PPh and BPJS by the 15th of the next month, PPN by the end of the next month. */
export function taxDeadline(period: string, type: TaxType) {
  const [y, m] = period.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const mm = String(nm).padStart(2, '0')
  if (type === 'ppn') return new Date(Date.UTC(ny, nm, 0)).toISOString().slice(0, 10)
  return `${ny}-${mm}-15`
}

export type TaxDueRow = {
  period: string
  type: TaxType
  owed: number
  paid: number
  due: number
  deadline: string
  /** PPh 21 only: owed from payroll (employees) vs withheld on vendor / freelancer bills. Filed together in one SPT. */
  employee?: number
  vendor?: number
}

/**
 * Tax owed vs deposited per tax month for one PT. Owed comes from the books:
 *   PPh 21/23/4(2)/26 = PPh withheld on outgoing bills dated in that month (+ PPh 21 from Employee OpEx)
 *   PPN = PPN on client invoices minus PPN on vendor bills (negative = overpaid / lebih bayar)
 *   BPJS = company share in Employee OpEx
 * Paid = tax_payment rows for that tax month. due = owed - paid.
 */
export async function taxDue(d1: D1Database, companyId: number, year: number): Promise<TaxDueRow[]> {
  const y = String(year)
  const owed = new Map<string, number>()
  const add = (period: string, type: TaxType, v: number) => {
    if (!v) return
    const k = period + '|' + type
    owed.set(k, (owed.get(k) ?? 0) + v)
  }
  const pph = await d1
    .prepare(
      `select substr(issue_date, 1, 7) period, pph_type, sum(pph) v from transactions
       where company_id = ? and direction = 'out' and status != 'void' and pph > 0 and substr(issue_date, 1, 4) = ?
       group by 1, 2`,
    )
    .bind(companyId, y)
    .all<{ period: string; pph_type: TaxType; v: number }>()
  const pph21 = new Map<string, { employee: number; vendor: number }>()
  for (const r of pph.results) {
    add(r.period, r.pph_type, r.v)
    if (r.pph_type === 'pph21') pph21.set(r.period, { employee: 0, vendor: r.v })
  }
  const ppn = await d1
    .prepare(
      `select substr(issue_date, 1, 7) period, sum(case when direction = 'in' then ppn else -ppn end) v from transactions
       where company_id = ? and status != 'void' and ppn != 0 and substr(issue_date, 1, 4) = ? group by 1`,
    )
    .bind(companyId, y)
    .all<{ period: string; v: number }>()
  for (const r of ppn.results) add(r.period, 'ppn', r.v)
  const pay = await d1
    .prepare(
      `select p.period, sum(p.pph21) pph21, sum(p.bpjs_tk) bpjs_tk, sum(p.bpjs_kes) bpjs_kes from payroll_months p
       join divisions d on d.id = p.division_id where d.company_id = ? and substr(p.period, 1, 4) = ? group by 1`,
    )
    .bind(companyId, y)
    .all<{ period: string; pph21: number; bpjs_tk: number; bpjs_kes: number }>()
  for (const r of pay.results) {
    add(r.period, 'pph21', r.pph21)
    add(r.period, 'bpjs_tk', r.bpjs_tk)
    add(r.period, 'bpjs_kes', r.bpjs_kes)
    if (r.pph21) pph21.set(r.period, { vendor: pph21.get(r.period)?.vendor ?? 0, employee: r.pph21 })
  }
  const paid = await d1
    .prepare(
      `select t.tax_period period, t.category type, sum(t.total) v from transactions t
       where t.company_id = ? and t.kind = 'tax_payment' and t.status != 'void' and substr(t.tax_period, 1, 4) = ? group by 1, 2`,
    )
    .bind(companyId, y)
    .all<{ period: string; type: TaxType; v: number }>()
  const paidMap = new Map(paid.results.map((r) => [r.period + '|' + r.type, r.v]))
  const keys = new Set([...owed.keys(), ...paidMap.keys()])
  return [...keys]
    .map((k) => {
      const [period, type] = k.split('|') as [string, TaxType]
      const o = owed.get(k) ?? 0
      const p = paidMap.get(k) ?? 0
      return { period, type, owed: o, paid: p, due: o - p, deadline: taxDeadline(period, type), ...(type === 'pph21' ? pph21.get(period) : {}) }
    })
    .sort((a, b) => a.period.localeCompare(b.period) || a.type.localeCompare(b.type))
}

// ------------------------------------------------------------------ approvals

const KIND_TEXT: Record<string, string> = {
  client_invoice: 'Client invoice',
  vendor_bill: 'Vendor bill',
  cash_advance: 'Cash advance',
  reimbursement: 'Reimbursement',
  settlement: 'Settlement',
  tax_payment: 'Tax payment',
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
/** Spend flow step 2+3: Finance acknowledges a spend request and proposes when to pay it. */
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
    throw new FinanceError(`approval ${id} needs Finance to acknowledge it and set a pay date before BOD can release it`)
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

export type TransactionFilter = ListFilter & {
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
  advance_id: number | null
  /** Cash advances: LPJ (settlement report) deadline, 5 working days after it was paid. Null once settled. */
  lpj_due: string | null
  /** Each payment as "YYYY-MM-DD amount", oldest first, joined by "; " (instalments). */
  payment_list: string | null
  tax_period: string | null
  account_id: number | null
  account_code: string | null
  note: string | null
  account: string | null
  category: string | null
  description: string | null
  requested_by: string | null
  attachment_url: string | null
  source: string
  company: string
  division: string | null
  division_id: number | null
  client_id: number | null
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
  if (f.from) (where.push('issue_date >= ?'), args.push(f.from))
  if (f.to) (where.push('issue_date <= ?'), args.push(f.to))
  if (f.divisionId) (where.push('division_id = ?'), args.push(f.divisionId))
  if (f.clientId) (where.push('client_id = ?'), args.push(f.clientId))
  if (f.projectCode) (where.push('project_code = ?'), args.push(f.projectCode))
  const q = `select v_transactions.*, (select group_concat(x, '; ') from (select p.date || ' ' || p.amount x from payments p
      where p.transaction_id = v_transactions.id order by p.date, p.id)) payment_list
    from v_transactions ${where.length ? 'where ' + where.join(' and ') : ''}
    order by coalesce(due_date, issue_date) desc, id desc limit ?`
  args.push(Math.min(f.limit ?? 200, 2000))
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
           coalesce(p.contract_value, (select coalesce(sum(charge), 0) from budget_lines b where b.project_id = p.id)) as contract,
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

/** Runs one read-only SELECT. The users (password hashes) and employees (KTP, NPWP, salary) tables cannot be read. */
export async function readonlyQuery(d1: D1Database, query: string, limit = 500) {
  const q = query.trim().replace(/;\s*$/, '')
  if (!/^(select|with)\b/i.test(q)) throw new FinanceError('only SELECT / WITH queries are allowed')
  if (q.includes(';')) throw new FinanceError('one statement only')
  if (FORBIDDEN.test(q)) throw new FinanceError('read-only: that keyword is not allowed')
  if (/\busers\b|\bemployees\b|password_hash|sqlite_master|_cf_/i.test(q)) throw new FinanceError('that table is not readable')
  const { results } = await d1.prepare(`select * from (${q}) limit ${Math.min(limit, 1000)}`).all()
  return results
}

// ------------------------------------------------------------------ payroll (Employee OpEx)

/** Monthly payroll totals per division for a year, plus year totals. Cost = salary + allowance + BPJS TK + BPJS Kes + PPh 21. */
export async function payrollSummary(db: Db, year: number) {
  const rows = await db
    .select({
      period: payrollMonths.period,
      division: divisions.name,
      netSalary: payrollMonths.netSalary,
      allowance: payrollMonths.allowance,
      bpjsTk: payrollMonths.bpjsTk,
      bpjsKes: payrollMonths.bpjsKes,
      pph21: payrollMonths.pph21,
      headcount: payrollMonths.headcount,
      status: payrollMonths.status,
    })
    .from(payrollMonths)
    .innerJoin(divisions, eq(divisions.id, payrollMonths.divisionId))
    .where(sql`${payrollMonths.period} like ${year + '-%'}`)
    .orderBy(asc(payrollMonths.period), asc(divisions.id))
  const sum = (k: 'netSalary' | 'allowance' | 'bpjsTk' | 'bpjsKes' | 'pph21') => rows.reduce((a, r) => a + r[k], 0)
  return {
    year,
    totals: {
      netSalary: sum('netSalary'),
      allowance: sum('allowance'),
      bpjsTk: sum('bpjsTk'),
      bpjsKes: sum('bpjsKes'),
      pph21: sum('pph21'),
      cost: sum('netSalary') + sum('allowance') + sum('bpjsTk') + sum('bpjsKes') + sum('pph21'),
    },
    rows: rows.map((r) => ({ ...r, cost: r.netSalary + r.allowance + r.bpjsTk + r.bpjsKes + r.pph21 })),
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
    allowance?: number
    bpjsTk?: number
    bpjsKes?: number
    pph21?: number
    headcount?: number
    notes?: string
  },
) {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new FinanceError('period must be YYYY-MM')
  const locked = await db
    .select({ id: payrollMonths.id })
    .from(payrollMonths)
    .where(and(eq(payrollMonths.period, input.period), eq(payrollMonths.status, 'approved')))
    .get()
  if (locked) throw new FinanceError(`${input.period} payroll is approved and locked. The owner must reopen it first.`)
  const values = {
    period: input.period,
    divisionId: input.divisionId,
    netSalary: Math.round(input.netSalary),
    allowance: Math.round(input.allowance ?? 0),
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

/** The month before a YYYY-MM period. */
export function previousPeriod(period: string) {
  const [y, m] = period.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/**
 * Starts a month's payroll as a draft copy of the month before (every division), for HR to edit before the owner approves.
 * Each month keeps its own amounts, so later raises never change past months. Refused if the month already has entries.
 */
export async function copyPayrollFromPrevious(db: Db, actor: Actor, period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new FinanceError('period must be YYYY-MM')
  const exists = await db.select({ id: payrollMonths.id }).from(payrollMonths).where(eq(payrollMonths.period, period)).get()
  if (exists) throw new FinanceError(`${period} already has payroll. Edit it instead.`)
  const from = previousPeriod(period)
  const prev = await db.select().from(payrollMonths).where(eq(payrollMonths.period, from)).all()
  if (prev.length === 0) throw new FinanceError(`no payroll in ${from} to copy`)
  const out = []
  for (const p of prev) {
    const values = {
      period,
      divisionId: p.divisionId,
      netSalary: p.netSalary,
      allowance: p.allowance,
      bpjsTk: p.bpjsTk,
      bpjsKes: p.bpjsKes,
      pph21: p.pph21,
      headcount: p.headcount,
      notes: null,
    }
    const [row] = await db.insert(payrollMonths).values(values).returning()
    await log(db, actor, 'create', 'payroll_months', row.id, { ...values, copiedFrom: from })
    out.push(row)
  }
  return { period, copiedFrom: from, rows: out.length }
}

/** Approves (locks) or reopens one month's payroll, all divisions together. Owner (BOD) only, enforced by the caller. */
export async function setPayrollMonthStatus(db: Db, actor: Actor, period: string, status: 'draft' | 'approved') {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new FinanceError('period must be YYYY-MM')
  const approved = status === 'approved'
  const rows = await db
    .update(payrollMonths)
    .set({
      status,
      approvedBy: approved ? String(actor) : null,
      approvedAt: approved ? new Date().toISOString() : null,
    })
    .where(eq(payrollMonths.period, period))
    .returning({ id: payrollMonths.id })
  if (rows.length === 0) throw new FinanceError(`no payroll entered for ${period}`)
  for (const r of rows) await log(db, actor, approved ? 'approve' : 'reopen', 'payroll_months', r.id, { period, status })
  return { period, status, rows: rows.length }
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
  const table =
    input.entity === 'transaction' ? transactions : input.entity === 'party' ? parties : input.entity === 'employee' ? employees : projects
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
