/**
 * MCP endpoint: the main way Sagacita Finance is operated (an agent on WhatsApp via Whip).
 * Reads: describe_schema + query (read-only SQL) cover almost everything.
 * Writes: a few typed tools, so tax math, budget checks and the activity log always run.
 */
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { DOCUMENT_ENTITIES, PARTY_KINDS, PPH_TYPES, PROJECT_TYPES, TRANSACTION_KINDS, TRANSACTION_STATUSES, USER_ROLES } from '#/db/schema'
import { bearerMatches } from '#/lib/auth'
import { getDb } from '#/lib/db'
import {
  FinanceError,
  addBudgetLine,
  createProject,
  findProject,
  addUser,
  listUsers,
  removeUser,
  resetUserPassword,
  setUserRole,
  setOpexBudget,
  updateProject,
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
  decideApproval,
  listApprovals,
  pnlReport,
  submitBudget,
  deleteBudgetLine,
  setProjectStatus,
  undoPayment,
  updateBudgetLine,
  updateParty,
  ensureParty,
  attachDocument,
  listDocuments,
  payrollSummary,
  recordPayroll,
  updateTransaction,
} from '#/lib/finance'

const GLOSSARY = `Talk to people in the web app's words, not the database's. Database term -> what people call it:
  budget_lines -> "SOW items" (the project's Budget Control page lists them). ceiling = "max expense + ASF".
  parties -> clients, vendors or employees (by kind). The client list page is "Client List".
  client_invoice -> "Invoice" (Invoicing page). dpp -> "net, before VAT". ppn -> "VAT 11%". pph -> "PPh" (23, 4(2), 26).
  vendor_bill -> "Vendor invoice" / "Expense". cash_advance -> "Cash advance". reimbursement -> "Reimbursement".
  Expense stages: draft -> "Advance Request", approved + unpaid -> "Approved", fully paid -> "Paid", settled -> "Done Settlement".
  Invoice stages: unpaid -> "Sent to client", part paid -> "Part paid", past due -> "Overdue", paid -> "Paid".
  payroll_months -> "Employee OpEx". opex_budgets -> "Company OpEx". divisions -> agencies. companies -> PTs.
  users -> "User Management". pnl_report / billing - costs -> "Performance" and "Net Profit Summary". approvals -> "Approvals".
  Money: say "Rp 1.2B" for billion (miliar) and "Rp 350M" for million (juta), or write it out in full.
Never show ids, table or column names to people unless they ask.`

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
  approvals     approval queue: entity (project|transaction), entity_id, status (pending|approved|rejected), summary, amount,
                requested_by, created_at, decided_by, decided_at, note. Project = its budget before it runs. Transaction = outgoing spend.
  documents     files in R2: entity (transaction|party|project), entity_id, kind, filename, content_type, size. URL = <app>/files/<id>
  activity_log  who changed what: at, actor, action, entity, entity_id, data (json)
  payroll_months Employee OpEx: period (YYYY-MM), division_id, net_salary, bpjs_tk, bpjs_kes (company share), pph21, headcount. Cost = sum of the four.
  (users is not readable here)

Rules:
  actual spend of a budget line = sum(dpp) of non-void 'out' transactions on it (cost before tax)
  margin = charge - actual spend
  payment run = approved, direction 'out', outstanding > 0, due by the run date (tool: payables_due)
  void rows are ignored everywhere.
  approvals: outgoing spend recorded as draft opens a pending approval automatically; new projects start draft and need
  submit_budget then approval to become active. Approving spend makes it payable; rejecting voids it.`

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

const actorField = z.string().min(1).describe('Who asked, e.g. "whatsapp:Rina". Stored in the activity log.')

function createServer(env: Env, appUrl: string) {
  const link = {
    project: (code: string) => `${appUrl}/projects/${encodeURIComponent(code)}`,
    payables: (dueBy: string) => `${appUrl}/payables?dueBy=${dueBy}`,
  }
  const db = getDb(env.DB)
  const server = new McpServer({ name: 'sagacita-finance', version: '1.0.0' }, { instructions: GLOSSARY })

  server.registerTool(
    'describe_schema',
    { description: 'The data model, the v_transactions view and the money rules. Read this before writing SQL.', inputSchema: {} },
    async () =>
      text(
        `Web app: ${appUrl}  (project page: ${appUrl}/projects/<code>, payment run: ${appUrl}/payables?dueBy=YYYY-MM-DD, all transactions: ${appUrl}/transactions). Share these links when a person wants to see details.\n\n` +
          SCHEMA_GUIDE +
          '\n\nGLOSSARY\n' +
          GLOSSARY,
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
    {
      description:
        "Companies (PTs), divisions and this year's company OpEx categories, with ids. Needed by create_project and company spend.",
      inputSchema: {},
    },
    async () =>
      safe(async () => ({
        companies: await listCompanies(db),
        divisions: await listDivisions(db),
        opexCategories: await listOpexCategories(db),
      })),
  )

  server.registerTool(
    'list_projects',
    {
      description: 'All projects with client, division and budget totals (charge, ceiling, actual, remaining, % used, margin).',
      inputSchema: {},
    },
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
        'Confirm the details with the person before calling. Spend that would take a budget line over its ceiling is saved as draft and waits for owner approval (decide_approval); it cannot be approved with set_transaction_status. ' +
        'Outgoing spend left as draft opens a pending approval (returned as `approval`); tell the person it is waiting for approval.',
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
      description:
        'Create a project (starts as draft). The client is created if new. Get divisionId from list_reference. ' +
        'Then add budget lines and call submit_budget so the owner can approve it.',
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

  server.registerTool(
    'submit_budget',
    {
      description: "Ask for approval of a draft project's budget (its budget lines). Approving it makes the project active.",
      inputSchema: { actor: actorField, project: z.string().describe('Project code or id'), note: z.string().optional() },
    },
    async ({ actor, project, note }) => safe(() => submitBudget(db, actor, project, note)),
  )

  server.registerTool(
    'list_approvals',
    {
      description:
        'The approval queue (budgets and spend). Default: pending ones. ' +
        'unnotified=true returns only new pending requests not yet posted to WhatsApp and marks them posted; ' +
        'use it from a routine and post each summary with its id, asking for "approve <id>" or "reject <id> <reason>".',
      inputSchema: {
        status: z.enum(['pending', 'approved', 'rejected']).optional(),
        unnotified: z.boolean().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async ({ status, unnotified, limit }) =>
      safe(async () => ({
        url: `${appUrl}/approvals`,
        approvals: await listApprovals(db, { status: unnotified ? undefined : (status ?? 'pending'), unnotified, limit }),
      })),
  )

  server.registerTool(
    'decide_approval',
    {
      description:
        'Approve or reject a pending approval. Only call this when the approver themselves said so (e.g. the owner replied "approve 12"). ' +
        'Approving spend makes it payable; rejecting voids it. Approving a budget makes the project active.',
      inputSchema: {
        actor: actorField,
        id: z.number().int(),
        decision: z.enum(['approve', 'reject']),
        note: z.string().optional().describe('Reason, required in practice for a reject'),
      },
    },
    async ({ actor, id, decision, note }) => safe(() => decideApproval(db, actor, id, decision, note)),
  )

  server.registerTool(
    'pnl_report',
    {
      description:
        'Profit and loss for a year in ONE call: totals (contract, project cost, gross profit, OpEx, operating profit, billed, collected), ' +
        'a monthly series (billed, project_cost, opex) and one row per project (contract, budget, cost, margin, billed). ' +
        'Use this for P&L dashboards instead of many query calls.',
      inputSchema: { year: z.number().int().optional().describe('Default: this year') },
    },
    async ({ year }) => safe(() => pnlReport(env.DB, year ?? new Date().getFullYear())),
  )

  server.registerTool(
    'update_transaction',
    {
      description:
        'Fix a transaction that has no payments yet: amount (dpp), PPN/PPh, dates, vendor/employee, budget line, number, description. ' +
        'Only pass the fields that change. Tax is recomputed. Confirm the change with the person first.',
      inputSchema: {
        actor: actorField,
        id: z.number().int(),
        budgetLineId: z.number().int().nullable().optional(),
        partyName: z.string().optional(),
        category: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        number: z.string().nullable().optional(),
        issueDate: z.string().optional(),
        dueDate: z.string().nullable().optional(),
        dpp: z.number().nonnegative().optional(),
        withPpn: z.boolean().optional(),
        pphType: z.enum(PPH_TYPES).optional(),
        pph: z.number().nonnegative().optional(),
        requestedBy: z.string().nullable().optional(),
        attachmentUrl: z.string().nullable().optional(),
      },
    },
    async ({ actor, id, ...input }) => safe(() => updateTransaction(db, actor, id, input)),
  )

  server.registerTool(
    'undo_payment',
    {
      description: 'Delete a payment recorded by mistake. Find the payment id with query (payments table). Confirm first.',
      inputSchema: { actor: actorField, paymentId: z.number().int() },
    },
    async ({ actor, paymentId }) => safe(() => undoPayment(db, actor, paymentId)),
  )

  server.registerTool(
    'update_budget_line',
    {
      description:
        'Change a budget line: name, charge, maxExpense, asfAmount, or delete=true to remove a line with no transactions. ' +
        'Returns a warning when an approved project budget changes. Confirm first.',
      inputSchema: {
        actor: actorField,
        id: z.number().int().describe('Budget line id from project_budget'),
        name: z.string().optional(),
        charge: z.number().nonnegative().optional(),
        maxExpense: z.number().nonnegative().optional(),
        asfAmount: z.number().nonnegative().optional(),
        delete: z.boolean().optional(),
      },
    },
    async ({ actor, id, delete: del, ...input }) =>
      safe(() => (del ? deleteBudgetLine(db, actor, id) : updateBudgetLine(db, actor, id, input))),
  )

  server.registerTool(
    'set_project_status',
    {
      description: 'Close a finished project, or reopen a closed one. (Draft projects become active only through budget approval.)',
      inputSchema: { actor: actorField, project: z.string(), status: z.enum(['active', 'closed']) },
    },
    async ({ actor, project, status }) => safe(() => setProjectStatus(db, actor, project, status)),
  )

  server.registerTool(
    'update_project',
    {
      description:
        'Edit a project: project number (code), name, client, division (agency), type, start/end dates. Pass only what changes. ' +
        'Changing the budget itself is update_budget_line / add_budget_line.',
      inputSchema: {
        actor: actorField,
        project: z.string().describe('Project code or id'),
        code: z.string().optional(),
        name: z.string().optional(),
        clientName: z.string().optional().describe('Client name; created if new'),
        divisionId: z.number().int().optional().describe('From list_reference'),
        type: z.enum(PROJECT_TYPES).optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
      },
    },
    async ({ actor, project, ...input }) =>
      safe(async () => {
        const p = await findProject(db, project)
        const row = await updateProject(db, actor, p.id, input)
        return { project: row, link: link.project(row.code) }
      }),
  )

  server.registerTool(
    'set_opex_budget',
    {
      description:
        'Set the annual budget of a Company OpEx category for a year (adds the category if it is new). Read current budgets with query on opex_budgets.',
      inputSchema: {
        actor: actorField,
        category: z.string().min(1),
        year: z.number().int(),
        annualBudget: z.number().nonnegative().describe('Rupiah'),
      },
    },
    async ({ actor, ...input }) => safe(() => setOpexBudget(db, actor, input)),
  )

  const userRef = z.string().describe('User email (or numeric id)')
  const toRef = (r: string) => (/^\d+$/.test(r) ? Number(r) : r)

  server.registerTool(
    'list_users',
    {
      description: 'Who can sign in to the web app, with their role (owner, finance, admin, hr). Never includes passwords.',
      inputSchema: {},
    },
    async () => safe(() => listUsers(db)),
  )

  server.registerTool(
    'add_user',
    {
      description:
        'Give someone a web app login. Returns a one-time temporary password: send it to that person privately, ' +
        'never in a group chat, and tell them to change it. Roles: owner = everything; finance = projects, budget, invoicing, expenses, reports; ' +
        'admin = projects, budget, expenses, clients; hr = Employee OpEx and Company OpEx.',
      inputSchema: { actor: actorField, email: z.string().email(), name: z.string().min(1), role: z.enum(USER_ROLES) },
    },
    async ({ actor, ...input }) => safe(async () => ({ ...(await addUser(db, actor, input)), login: `${appUrl}/login` })),
  )

  server.registerTool(
    'set_user_role',
    {
      description: 'Change what a user can see in the web app. The last owner cannot be demoted.',
      inputSchema: { actor: actorField, user: userRef, role: z.enum(USER_ROLES) },
    },
    async ({ actor, user, role }) => safe(() => setUserRole(db, actor, toRef(user), role)),
  )

  server.registerTool(
    'reset_user_password',
    {
      description:
        "Reset a user's web app password to a new random one-time password, returned once. Send it only to that person, privately. " +
        'You cannot choose the password.',
      inputSchema: { actor: actorField, user: userRef },
    },
    async ({ actor, user }) => safe(async () => ({ ...(await resetUserPassword(db, actor, toRef(user))), login: `${appUrl}/login` })),
  )

  server.registerTool(
    'remove_user',
    {
      description:
        "Take away someone's web app login. Their past entries stay. The last owner cannot be removed. Confirm with the person asking first.",
      inputSchema: { actor: actorField, user: userRef },
    },
    async ({ actor, user }) => safe(() => removeUser(db, actor, toRef(user))),
  )

  server.registerTool(
    'update_party',
    {
      description: 'Update a client, vendor or employee: name, NPWP, bank account, notes. Find the id with query (parties table).',
      inputSchema: {
        actor: actorField,
        id: z.number().int(),
        name: z.string().optional(),
        npwp: z.string().nullable().optional(),
        bankAccount: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      },
    },
    async ({ actor, id, ...input }) => safe(() => updateParty(db, actor, id, input)),
  )

  server.registerTool(
    'create_party',
    {
      description:
        'Add a client, vendor or employee (returns the existing one if the name already exists for that kind). ' +
        'record_transaction and create_project also create parties by name automatically.',
      inputSchema: {
        actor: actorField,
        kind: z.enum(PARTY_KINDS),
        name: z.string().min(1),
        npwp: z.string().optional(),
        bankAccount: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async ({ actor, kind, name, ...extra }) =>
      safe(async () => {
        const party = await ensureParty(db, actor, kind, name)
        return Object.values(extra).some(Boolean) ? updateParty(db, actor, party.id, extra) : party
      }),
  )

  server.registerTool(
    'payroll_summary',
    {
      description:
        'Employee OpEx for a year: monthly payroll totals per division (net salary, BPJS TK/Kes, PPh 21, cost) and year totals. Salaries are sensitive: share only with the owner or HR.',
      inputSchema: { year: z.number().int().optional() },
    },
    async ({ year }) => safe(() => payrollSummary(db, year ?? new Date().getFullYear())),
  )

  server.registerTool(
    'record_payroll',
    {
      description:
        "Save one month's payroll totals for one division (from HR's payroll Excel). Saving the same month + division again replaces it. divisionId from list_reference.",
      inputSchema: {
        actor: actorField,
        period: z.string().describe('YYYY-MM'),
        divisionId: z.number().int(),
        netSalary: z.number().nonnegative(),
        bpjsTk: z.number().nonnegative().optional(),
        bpjsKes: z.number().nonnegative().optional(),
        pph21: z.number().nonnegative().optional(),
        headcount: z.number().int().optional(),
        notes: z.string().optional(),
      },
    },
    async ({ actor, ...input }) => safe(() => recordPayroll(db, actor, input)),
  )

  server.registerTool(
    'attach_document',
    {
      description:
        'Keep a file (invoice / receipt photo, KTP, NPWP, contract, PO) on a transaction, party or project. ' +
        'Pass fileUrl (a direct https link to the file, e.g. the WhatsApp media URL) or base64 + filename + contentType. Max 15 MB. ' +
        'The first file on a transaction also becomes its attachment_url.',
      inputSchema: {
        actor: actorField,
        entity: z.enum(DOCUMENT_ENTITIES),
        entityId: z.number().int(),
        kind: z.string().optional().describe('invoice, receipt, ktp, npwp, contract, po ...'),
        fileUrl: z.string().url().optional(),
        base64: z.string().optional(),
        filename: z.string().optional(),
        contentType: z.string().optional(),
      },
    },
    async ({ actor, entity, entityId, kind, fileUrl, base64, filename, contentType }) =>
      safe(async () => {
        let bytes: ArrayBuffer
        let type = contentType
        let name = filename
        if (fileUrl) {
          const res = await fetch(fileUrl)
          if (!res.ok) throw new FinanceError(`could not download the file (${res.status})`)
          bytes = await res.arrayBuffer()
          type ??= res.headers.get('content-type') ?? 'application/octet-stream'
          name ??= decodeURIComponent(new URL(fileUrl).pathname.split('/').pop() || 'file')
        } else if (base64) {
          const bin = atob(base64.replace(/^data:[^,]*,/, ''))
          const arr = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
          bytes = arr.buffer
        } else throw new FinanceError('pass fileUrl or base64')
        return attachDocument(db, env.DOCS, actor, appUrl, {
          entity,
          entityId,
          kind,
          bytes,
          filename: name ?? 'file',
          contentType: type ?? 'application/octet-stream',
        })
      }),
  )

  server.registerTool(
    'list_documents',
    {
      description: 'Files kept on a transaction, party or project, with their URLs.',
      inputSchema: { entity: z.enum(DOCUMENT_ENTITIES), entityId: z.number().int() },
    },
    async ({ entity, entityId }) => safe(() => listDocuments(db, appUrl, entity, entityId)),
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
