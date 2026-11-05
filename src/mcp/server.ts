/**
 * MCP endpoint: the main way Sagacita Finance is operated (an agent on WhatsApp via Whip).
 * Reads: describe_schema + query (read-only SQL) cover almost everything.
 * Writes: a few typed tools, so tax math, budget checks and the activity log always run.
 */
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { PPH_TYPES, PROJECT_TYPES, TRANSACTION_KINDS, TRANSACTION_STATUSES } from '#/db/schema'
import { bearerMatches } from '#/lib/auth'
import { getDb } from '#/lib/db'
import {
  FinanceError,
  addBudgetLine,
  createProject,
  findProject,
  listCompanies,
  listDivisions,
  listOpexCategories,
  listProjects,
  payablesDue,
  projectBudget,
  readonlyQuery,
  recordPayment,
  recordTransaction,
  setTransactionStatus,
} from '#/lib/finance'

const SCHEMA_GUIDE = `Sagacita Finance data model (SQLite / Cloudflare D1). Money is integer rupiah. Dates are YYYY-MM-DD.

START HERE: v_transactions — every transaction with names joined in and paid / outstanding / overdue computed.
  columns: id, kind, direction, status, number, issue_date, due_date, dpp, ppn, pph_type, pph, total,
           paid, outstanding, overdue (0/1), category, description, requested_by, source, attachment_url,
           company_id, company, division_id, division, project_id, project_code, project_name,
           client_id, client, budget_line_id, budget_line, party_id, party, party_kind, created_at, updated_at

Tables:
  transactions  the raw data. kind: client_invoice (direction in) | vendor_bill | cash_advance | reimbursement (direction out)
                status: draft | approved | settled | void.  total = dpp + ppn - pph.
                Paid / overdue are NOT stored: use v_transactions.
  payments      cash that moved: transaction_id, direction, amount, date, method, reference, note. Partial payment = several rows.
  projects      id, code (project number), name, client_id -> parties, division_id -> divisions, type (retainer|project), status, start_date, end_date
  budget_lines  SOW items: project_id, name, charge (client price), max_expense, asf_amount. ceiling = max_expense + asf_amount
  parties       clients, vendors, employees: kind, name, npwp, bank_account
  divisions     agencies (Sagacita PR, SagaDigital, Arra Comms) -> company_id
  companies     PTs (tax reporting is per company)
  opex_budgets  company OpEx: category, fiscal_year, annual_budget, is_fixed. Actual = non-project 'out' transactions with that category
  activity_log  who changed what: at, actor, action, entity, entity_id, data (json)
  (payroll_months and users exist but are not readable here)

Rules:
  actual spend of a budget line = sum(dpp) of non-void 'out' transactions on it (cost before tax)
  margin = charge - actual spend
  payment run = approved, direction 'out', outstanding > 0, due by the run date (tool: payables_due)
  void rows are ignored everywhere.`

const text = (data: unknown) => ({
  content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
})

async function safe(fn: () => Promise<unknown>) {
  try {
    return text(await fn())
  } catch (error) {
    if (error instanceof FinanceError) return { ...text({ error: error.message }), isError: true }
    throw error
  }
}

const actorField = z
  .string()
  .min(1)
  .describe('Who asked, e.g. "whatsapp:Rina". Stored in the activity log.')

function createServer(env: Env, appUrl: string) {
  const link = {
    project: (code: string) => `${appUrl}/projects/${encodeURIComponent(code)}`,
    payables: (dueBy: string) => `${appUrl}/payables?dueBy=${dueBy}`,
  }
  const db = getDb(env.DB)
  const server = new McpServer({ name: 'sagacita-finance', version: '1.0.0' })

  server.registerTool(
    'describe_schema',
    { description: 'The data model, the v_transactions view and the money rules. Read this before writing SQL.', inputSchema: {} },
    async () =>
      text(
        `Web app: ${appUrl}  (project page: ${appUrl}/projects/<code>, payment run: ${appUrl}/payables?dueBy=YYYY-MM-DD, all transactions: ${appUrl}/transactions). Share these links when a person wants to see details.\n\n` +
          SCHEMA_GUIDE,
      ),
  )

  server.registerTool(
    'query',
    {
      description:
        'Run one read-only SELECT (or WITH … SELECT) on the finance database. Prefer v_transactions. Up to 1000 rows; prefer aggregates.',
      inputSchema: { sql: z.string().min(1).max(10_000), limit: z.number().int().min(1).max(1000).optional() },
    },
    async ({ sql, limit }) => safe(() => readonlyQuery(env.DB, sql, limit)),
  )

  server.registerTool(
    'list_reference',
    { description: 'Companies (PTs), divisions and this year\'s company OpEx categories, with ids. Needed by create_project and company spend.', inputSchema: {} },
    async () =>
      safe(async () => ({
        companies: await listCompanies(db),
        divisions: await listDivisions(db),
        opexCategories: await listOpexCategories(db),
      })),
  )

  server.registerTool(
    'list_projects',
    { description: 'All projects with client, division and budget totals (charge, ceiling, actual, remaining, % used, margin).', inputSchema: {} },
    async () => safe(async () => (await listProjects(db)).map((p) => ({ ...p, url: link.project(p.code) }))),
  )

  server.registerTool(
    'project_budget',
    {
      description: 'Budget vs actual for one project, per budget line (SOW item). Use the line ids when recording spend.',
      inputSchema: { project: z.string().describe('Project code or id') },
    },
    async ({ project }) =>
      safe(async () => {
        const p = await findProject(db, project)
        return { project: p, url: link.project(p.code), ...(await projectBudget(db, p.id)) }
      }),
  )

  server.registerTool(
    'payables_due',
    {
      description: 'Approved, unpaid outgoing transactions due by a date (or with no due date): the list for a payment run.',
      inputSchema: { dueBy: z.string().describe('YYYY-MM-DD, usually the coming Wednesday or Friday') },
    },
    async ({ dueBy }) => safe(async () => ({ url: link.payables(dueBy), ...(await payablesDue(env.DB, dueBy)) })),
  )

  server.registerTool(
    'record_transaction',
    {
      description:
        'Record a client invoice, vendor bill, cash advance or reimbursement. PPN (11%) and PPh are computed from dpp. ' +
        'Confirm the details with the person before calling. Returns a warning when a budget line goes over its ceiling.',
      inputSchema: {
        actor: actorField,
        kind: z.enum(TRANSACTION_KINDS),
        project: z.string().optional().describe('Project code or id. Omit for company spend (then companyId is required).'),
        budgetLineId: z.number().int().optional().describe('From project_budget. Needed for project spend.'),
        companyId: z.number().int().optional(),
        divisionId: z.number().int().optional().describe('For company spend: the division it belongs to, if any'),
        partyName: z.string().optional().describe('Vendor or employee name (created if new). Client comes from the project.'),
        category: z.string().optional().describe('For company spend: an opex category from list_reference, e.g. "Office Rental"'),
        description: z.string().optional(),
        number: z.string().optional().describe('Invoice / bill number on the paper'),
        issueDate: z.string().optional(),
        dueDate: z.string().optional(),
        dpp: z.number().nonnegative().describe('Amount before tax, rupiah'),
        withPpn: z.boolean().optional().describe('false when the vendor charges no VAT (non-PKP). Default true.'),
        pphType: z.enum(PPH_TYPES).optional(),
        pph: z.number().nonnegative().optional().describe('Withheld amount; required for pph21, otherwise the default rate is used'),
        status: z.enum(TRANSACTION_STATUSES).optional().describe('Default draft'),
        requestedBy: z.string().optional(),
        attachmentUrl: z.string().optional(),
      },
    },
    async ({ actor, project, ...input }) =>
      safe(async () => {
        const p = project ? await findProject(db, project) : null
        const result = await recordTransaction(db, actor, { ...input, projectId: p?.id ?? null, source: 'whatsapp' })
        return { ...result, url: p ? link.project(p.code) : `${appUrl}/transactions` }
      }),
  )

  server.registerTool(
    'set_transaction_status',
    {
      description: 'Approve, settle (cash advance receipts handed in) or void a transaction. Confirm first.',
      inputSchema: { actor: actorField, id: z.number().int(), status: z.enum(TRANSACTION_STATUSES) },
    },
    async ({ actor, id, status }) => safe(() => setTransactionStatus(db, actor, id, status)),
  )

  server.registerTool(
    'record_payment',
    {
      description:
        'Record cash paid out or received against a transaction. Omit amount to pay the full outstanding. Partial payments allowed. Confirm first.',
      inputSchema: {
        actor: actorField,
        transactionId: z.number().int(),
        amount: z.number().positive().optional(),
        date: z.string().optional(),
        method: z.string().optional(),
        reference: z.string().optional(),
        note: z.string().optional(),
      },
    },
    async ({ actor, ...input }) => safe(() => recordPayment(db, actor, input)),
  )

  server.registerTool(
    'create_project',
    {
      description: 'Create a project. The client is created if new. Get divisionId from list_reference.',
      inputSchema: {
        actor: actorField,
        code: z.string().min(1),
        name: z.string().min(1),
        clientName: z.string().min(1),
        divisionId: z.number().int(),
        type: z.enum(PROJECT_TYPES),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      },
    },
    async ({ actor, ...input }) => safe(() => createProject(db, actor, input)),
  )

  server.registerTool(
    'add_budget_line',
    {
      description: 'Add a budget line (SOW item) to a project.',
      inputSchema: {
        actor: actorField,
        project: z.string(),
        name: z.string().min(1),
        charge: z.number().nonnegative(),
        maxExpense: z.number().nonnegative(),
        asfAmount: z.number().nonnegative().optional(),
      },
    },
    async ({ actor, project, ...input }) =>
      safe(async () => addBudgetLine(db, actor, { ...input, projectId: (await findProject(db, project)).id })),
  )

  return server
}

export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version',
      },
    })
  }
  if (!bearerMatches(request, env.MCP_TOKEN)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
    })
  }
  const appUrl = env.APP_URL || new URL(request.url).origin
  return createMcpHandler(() => createServer(env, appUrl), { legacy: 'stateless' }).fetch(request)
}
