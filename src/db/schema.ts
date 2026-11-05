/**
 * Sagacita finance data model. See docs/schema.md for the why.
 *
 * Three layers:
 *   1. Who and what:  companies, divisions, parties, projects, budget_lines
 *   2. transactions:  the raw finance data. One wide row per client invoice, vendor bill,
 *                     cash advance or reimbursement, carrying client, project, budget line,
 *                     vendor and tax, so one table answers most questions.
 *   3. payments:      the cash that actually moved against a transaction (partial = several rows)
 *
 * Money is integer rupiah. Dates are ISO text (YYYY-MM-DD), timestamps ISO text.
 */
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const id = () => integer('id').primaryKey({ autoIncrement: true })
const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
const updatedAt = () =>
  text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)

// ---------------------------------------------------------------- users

export const USER_ROLES = ['owner', 'finance', 'admin', 'hr'] as const

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role', { enum: USER_ROLES }).notNull().default('finance'),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
})

// ---------------------------------------------------------------- who and what

/** A legal entity (PT). Tax reporting is per company. */
export const companies = sqliteTable('companies', {
  id: id(),
  name: text('name').notNull().unique(),
  npwp: text('npwp'),
  createdAt: createdAt(),
})

/** An agency / brand (Sagacita PR, SagaDigital, Arra Comms). Performance is per division. */
export const divisions = sqliteTable('divisions', {
  id: id(),
  companyId: integer('company_id')
    .notNull()
    .references(() => companies.id),
  name: text('name').notNull().unique(),
  createdAt: createdAt(),
})

export const PARTY_KINDS = ['client', 'vendor', 'employee'] as const

/** Anyone money comes from or goes to. One table so "everything with Honda" is one lookup. */
export const parties = sqliteTable(
  'parties',
  {
    id: id(),
    kind: text('kind', { enum: PARTY_KINDS }).notNull(),
    name: text('name').notNull(),
    npwp: text('npwp'),
    bankAccount: text('bank_account'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('parties_kind_name').on(t.kind, t.name)],
)

export const PROJECT_TYPES = ['retainer', 'project'] as const
export const PROJECT_STATUSES = ['draft', 'active', 'closed'] as const

export const projects = sqliteTable(
  'projects',
  {
    id: id(),
    code: text('code').notNull().unique(), // the project number, e.g. HND-2026-01
    name: text('name').notNull(),
    clientId: integer('client_id')
      .notNull()
      .references(() => parties.id),
    divisionId: integer('division_id')
      .notNull()
      .references(() => divisions.id),
    type: text('type', { enum: PROJECT_TYPES }).notNull(),
    status: text('status', { enum: PROJECT_STATUSES }).notNull().default('active'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_client').on(t.clientId), index('projects_division').on(t.divisionId)],
)

/**
 * A SOW item / budget control line. ceiling = max_expense + asf_amount
 * (same rule as the old dashboard). charge is what the client pays for it.
 */
export const budgetLines = sqliteTable(
  'budget_lines',
  {
    id: id(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    charge: integer('charge').notNull().default(0),
    maxExpense: integer('max_expense').notNull().default(0),
    asfAmount: integer('asf_amount').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('budget_lines_project').on(t.projectId)],
)

// ---------------------------------------------------------------- transactions (the raw data)

export const TRANSACTION_KINDS = [
  'client_invoice', // money in, from a client
  'vendor_bill', // money out, to a vendor
  'cash_advance', // money out up front, settled later with receipts
  'reimbursement', // money out, paying back someone who spent their own
] as const

/** in for client_invoice, out for the rest. Stored so queries never need to know the kinds. */
export const DIRECTIONS = ['in', 'out'] as const

export const TRANSACTION_STATUSES = [
  'draft', // recorded, not approved yet
  'approved', // ok to pay / sent to client
  'settled', // cash advance: receipts handed in and matched
  'void', // cancelled, ignored everywhere
] as const

export const PPH_TYPES = ['none', 'pph21', 'pph23', 'pph4_2', 'pph26'] as const

/**
 * One row per thing that creates an amount owed. Whether it is paid is NOT a status:
 * it is sum(payments.amount) vs total, so it can never go stale.
 * Overdue = due_date < today and not fully paid, also derived.
 *
 * total = dpp + ppn - pph (the cash that should move).
 */
export const transactions = sqliteTable(
  'transactions',
  {
    id: id(),
    kind: text('kind', { enum: TRANSACTION_KINDS }).notNull(),
    direction: text('direction', { enum: DIRECTIONS }).notNull(),
    status: text('status', { enum: TRANSACTION_STATUSES }).notNull().default('draft'),
    number: text('number'), // invoice / bill number printed on the paper
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    partyId: integer('party_id').references(() => parties.id),
    projectId: integer('project_id').references(() => projects.id),
    budgetLineId: integer('budget_line_id').references(() => budgetLines.id),
    /** For rows with no project (company spend): which division it belongs to, if any. */
    divisionId: integer('division_id').references(() => divisions.id),
    /** Company OpEx category for spend that is not on a project: matches opex_budgets.category. */
    category: text('category'),
    description: text('description'),
    issueDate: text('issue_date').notNull(),
    dueDate: text('due_date'),
    dpp: integer('dpp').notNull().default(0), // base before tax
    ppn: integer('ppn').notNull().default(0), // VAT, normally 11% of dpp
    pphType: text('pph_type', { enum: PPH_TYPES }).notNull().default('none'),
    pph: integer('pph').notNull().default(0), // withheld tax
    total: integer('total').notNull().default(0), // dpp + ppn - pph
    requestedBy: text('requested_by'),
    attachmentUrl: text('attachment_url'),
    source: text('source', { enum: ['web', 'whatsapp', 'import'] })
      .notNull()
      .default('web'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('transactions_project').on(t.projectId),
    index('transactions_budget_line').on(t.budgetLineId),
    index('transactions_party').on(t.partyId),
    index('transactions_due').on(t.direction, t.dueDate),
  ],
)

// ---------------------------------------------------------------- payments

/**
 * Every real cash movement. Partial payments are just several rows.
 * amount is always positive; direction says which way.
 * transaction_id is null for money that moved with nothing owed behind it (bank fee, interest).
 */
export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    direction: text('direction', { enum: DIRECTIONS }).notNull(),
    amount: integer('amount').notNull(),
    date: text('date').notNull(),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    transactionId: integer('transaction_id').references(() => transactions.id),
    method: text('method'), // transfer, cash, ...
    reference: text('reference'), // bank ref
    note: text('note'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('payments_transaction').on(t.transactionId), index('payments_date').on(t.date)],
)

// ---------------------------------------------------------------- audit

/** Who changed what, from where. Written by every mutation (web and MCP). */
export const activityLog = sqliteTable(
  'activity_log',
  {
    id: id(),
    at: createdAt(),
    actor: text('actor').notNull(), // user email, or "whatsapp:<sender name>"
    action: text('action').notNull(), // create / update / delete / pay
    entity: text('entity').notNull(), // table name
    entityId: integer('entity_id').notNull(),
    data: text('data', { mode: 'json' }),
  },
  (t) => [index('activity_entity').on(t.entity, t.entityId)],
)

/**
 * v_transactions (created in drizzle/0001_view.sql): every transaction with names
 * joined in and paid / outstanding / overdue worked out. The MCP `query` tool
 * points the agent here first.
 */

// ---------------------------------------------------------------- company opex budgets

/** Annual budget per company OpEx category. Actuals = non-project out transactions with that category. */
export const opexBudgets = sqliteTable(
  'opex_budgets',
  {
    id: id(),
    category: text('category').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    annualBudget: integer('annual_budget').notNull().default(0),
    isFixed: integer('is_fixed', { mode: 'boolean' }).notNull().default(false), // e.g. Office Rental, budget / 12 each month
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('opex_budgets_category_year').on(t.category, t.fiscalYear)],
)

// ---------------------------------------------------------------- payroll (owner / hr only)

/**
 * Monthly payroll totals per division (Employee OpEx). Kept out of transactions on purpose:
 * salary data is owner/hr only, and the MCP query tool cannot read this table.
 */
export const payrollMonths = sqliteTable(
  'payroll_months',
  {
    id: id(),
    period: text('period').notNull(), // YYYY-MM
    divisionId: integer('division_id')
      .notNull()
      .references(() => divisions.id),
    netSalary: integer('net_salary').notNull().default(0),
    bpjsTk: integer('bpjs_tk').notNull().default(0), // company share
    bpjsKes: integer('bpjs_kes').notNull().default(0), // company share
    pph21: integer('pph21').notNull().default(0),
    headcount: integer('headcount'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payroll_period_division').on(t.period, t.divisionId)],
)

