/** Server functions for the reporting / admin pages carried over from the original app. */
import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { asc, eq, like, sql } from 'drizzle-orm'
import { z } from 'zod'

import { PPH_TYPES, PROJECT_TYPES, TAX_TYPES, USER_ROLES, divisions, employees, opexBudgets, payrollMonths, projects, transactions, users } from '#/db/schema'
import { SESSION_COOKIE, hashPassword, readSession } from '#/lib/auth'
import { getDb } from '#/lib/db'
import { filterSearch, rangeOf, toListFilter } from '#/lib/filters'
import {
  deleteBudgetLine,
  ensureParty,
  suggestClientCode,
  updateParty,
  listActivity,
  listDivisions,
  log,
  recordPayroll,
  setPayrollMonthStatus,
  listParties,
  listProjects,
  listTransactions,
  updateBudgetLine,
  setOpexBudget,
  setUserRole,
  updateProject,
  updateTransaction,
  createCompany,
  updateCompany,
  createDivision,
  updateDivision,
  listCompanies,
  recordTaxPayment,
  recordMedicalClaim,
  medicalUsage,
  taxDue,
  pnlByAccount,
  balanceSheet,
  setOpeningBalances,
} from '#/lib/finance'

type Role = (typeof USER_ROLES)[number]

async function requireRole(...roles: Role[]) {
  const id = await readSession(getCookie(SESSION_COOKIE), env.SESSION_SECRET)
  const user = id ? await getDb().select().from(users).where(eq(users.id, id)).get() : null
  if (!user) throw new Error('Not signed in')
  if (roles.length && !roles.includes(user.role as Role)) throw new Error("You don't have access to this section")
  return user
}

const yearSchema = z.object({ year: z.number().int().optional() })

// ------------------------------------------------------------ projects / budget control

export const updateProjectFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.number().int(),
      code: z.string().optional(),
      name: z.string().optional(),
      clientId: z.number().int().optional(),
      divisionId: z.number().int().optional(),
      type: z.enum(PROJECT_TYPES).optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      contractValue: z.number().nonnegative().nullable().optional(),
    }),
  )
  .handler(async ({ data: { id, ...input } }) => {
    const user = await requireRole('owner', 'finance', 'admin')
    return updateProject(getDb(), user.email, id, input)
  })

export const updateBudgetLineFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.number().int(),
      name: z.string().optional(),
      charge: z.number().optional(),
      maxExpense: z.number().optional(),
      asfAmount: z.number().optional(),
      delete: z.boolean().optional(),
    }),
  )
  .handler(async ({ data: { id, delete: del, ...input } }) => {
    const user = await requireRole('owner', 'finance', 'admin')
    return del ? deleteBudgetLine(getDb(), user.email, id) : updateBudgetLine(getDb(), user.email, id, input)
  })

// ------------------------------------------------------------ invoicing / expenses

export const getInvoicing = createServerFn()
  .validator(filterSearch)
  .handler(async ({ data }) => {
    await requireRole('owner', 'finance')
    const f = toListFilter(data)
    const [invoices, ps] = await Promise.all([listTransactions(env.DB, { ...f, direction: 'in', limit: 2000 }), listProjects(getDb(), f)])
    return { invoices, projects: ps }
  })

export const getExpenses = createServerFn()
  .validator(filterSearch)
  .handler(async ({ data }) => {
    await requireRole('owner', 'finance', 'admin')
    return listTransactions(env.DB, { ...toListFilter(data), direction: 'out', limit: 2000 })
  })

export const updateTransactionFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
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
      requestedBy: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data: { id, ...input } }) => {
    const user = await requireRole('owner', 'finance', 'admin')
    return updateTransaction(getDb(), user.email, id, input)
  })

// ------------------------------------------------------------ performance

export const getPerformance = createServerFn()
  .validator(filterSearch)
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'finance')
    const f = toListFilter(data)
    const db = getDb()
    const ps = await listProjects(db, f)
    const rows = ps.map((p) => {
      const billing = Math.max(p.totals.charge, p.totals.billed)
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        client: p.client,
        division: p.division,
        billing,
        allocExp: p.totals.ceiling,
        estMargin: billing - p.totals.ceiling,
        estPct: billing ? ((billing - p.totals.ceiling) / billing) * 100 : 0,
        actualExp: p.totals.actual,
        margin: billing - p.totals.actual,
      }
    })
    let owner: null | { projectExpenses: number; employeeOpex: number; companyOpex: number } = null
    if (user.role === 'owner') {
      const pay = await db
        .select({ v: sql<number>`coalesce(sum(net_salary + bpjs_tk + bpjs_kes + pph21), 0)` })
        .from(payrollMonths)
        .where(sql`${payrollMonths.period} >= ${f.from?.slice(0, 7) ?? '0000'} and ${payrollMonths.period} <= ${f.to?.slice(0, 7) ?? '9999'}`)
        .get()
      const opex = await env.DB.prepare(
        `select coalesce(sum(dpp), 0) v from transactions where direction = 'out' and status != 'void' and project_id is null and issue_date >= ? and issue_date <= ?`,
      )
        .bind(f.from ?? '0000', f.to ?? '9999')
        .first<{ v: number }>()
      owner = {
        projectExpenses: rows.reduce((a, r) => a + r.actualExp, 0),
        employeeOpex: Number(pay?.v ?? 0),
        companyOpex: Number(opex?.v ?? 0),
      }
    }
    return { rows, owner }
  })

// ------------------------------------------------------------ cash flow

export const getCashflow = createServerFn()
  .validator(filterSearch)
  .handler(async ({ data }) => {
    await requireRole('owner', 'finance')
    const d1 = env.DB
    const f = toListFilter(data)
    // Payments joined to their transaction, so division / client / project filters apply.
    const scope: string[] = []
    const args: unknown[] = []
    if (f.divisionId) (scope.push('t.division_id = ?'), args.push(f.divisionId))
    if (f.clientId) (scope.push('t.client_id = ?'), args.push(f.clientId))
    if (f.projectCode) (scope.push('t.project_code = ?'), args.push(f.projectCode))
    const scopeSql = scope.map((w) => ' and ' + w).join('')
    const dateSql = (f.from ? ' and y.date >= ?' : '') + (f.to ? ' and y.date <= ?' : '')
    const dateArgs = [f.from, f.to].filter(Boolean)
    const monthly = (
      await d1
        .prepare(
          `select substr(y.date, 1, 7) m, y.direction, coalesce(sum(y.amount), 0) v
           from payments y join v_transactions t on t.id = y.transaction_id
           where y.date is not null${dateSql}${scopeSql} group by m, y.direction order by m`,
        )
        .bind(...dateArgs, ...args)
        .all<{ m: string; direction: 'in' | 'out'; v: number }>()
    ).results
    // One bar per month of the range (all years: from the first to the last payment month).
    const first = f.from?.slice(0, 7) ?? monthly[0]?.m ?? new Date().toISOString().slice(0, 7)
    const last = f.to?.slice(0, 7) ?? monthly.at(-1)?.m ?? first
    const months: string[] = []
    for (let [y, m] = first.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= last && months.length < 120; m === 12 ? (y++, (m = 1)) : m++)
      months.push(`${y}-${String(m).padStart(2, '0')}`)
    const inM = months.map((k) => monthly.find((r) => r.m === k && r.direction === 'in')?.v ?? 0)
    const outM = months.map((k) => monthly.find((r) => r.m === k && r.direction === 'out')?.v ?? 0)
    // "Now" figures ignore the date range but follow division / client / project.
    const horizon = async (days: number) =>
      (
        await d1
          .prepare(
            `select coalesce(sum(outstanding), 0) v from v_transactions t
             where direction = 'in' and status != 'void' and outstanding > 0
               and due_date >= date('now') and due_date <= date('now', ?)${scopeSql}`,
          )
          .bind(`+${days} days`, ...args)
          .first<{ v: number }>()
      )?.v ?? 0
    const overdue = await d1
      .prepare(
        `select coalesce(sum(outstanding), 0) v, count(*) n from v_transactions t
         where direction = 'in' and status != 'void' and overdue = 1${scopeSql}`,
      )
      .bind(...args)
      .first<{ v: number; n: number }>()
    const byProject = (
      await d1
        .prepare(
          `select t.project_code code, t.project_name name, t.client,
             sum(case when y.direction = 'in' then y.amount else 0 end) collected,
             sum(case when y.direction = 'out' then y.amount else 0 end) paid_out
           from payments y join v_transactions t on t.id = y.transaction_id
           where t.project_id is not null${dateSql}${scopeSql}
           group by t.project_id order by t.project_code`,
        )
        .bind(...dateArgs, ...args)
        .all<{ code: string; name: string; client: string; collected: number; paid_out: number }>()
    ).results
    const invoiced = (
      await d1
        .prepare(
          `select project_code code, coalesce(sum(total), 0) v from v_transactions t
           where direction = 'in' and status != 'void' and project_id is not null${f.from ? ' and issue_date >= ?' : ''}${f.to ? ' and issue_date <= ?' : ''}${scopeSql}
           group by project_id`,
        )
        .bind(...dateArgs, ...args)
        .all<{ code: string; v: number }>()
    ).results
    const sum = (xs: number[]) => xs.reduce((a, v) => a + v, 0)
    return {
      months,
      overdue: overdue?.v ?? 0,
      overdueCount: overdue?.n ?? 0,
      collected: sum(inM),
      paidOut: sum(outM),
      next30: await horizon(30),
      next90: await horizon(90),
      next180: await horizon(180),
      inM,
      outM,
      byProject: byProject.map((p) => ({ ...p, invoiced: invoiced.find((i) => i.code === p.code)?.v ?? 0 })),
    }
  })

// ------------------------------------------------------------ employee opex (payroll, owner / hr)

export const getPayroll = createServerFn()
  .validator(yearSchema)
  .handler(async ({ data }) => {
    const me = await requireRole('owner', 'hr')
    const db = getDb()
    const latest = await db.select({ p: sql<string | null>`max(${payrollMonths.period})` }).from(payrollMonths).get()
    const year = data.year ?? (latest?.p ? Number(latest.p.slice(0, 4)) : new Date().getFullYear())
    const rows = await db
      .select()
      .from(payrollMonths)
      .where(like(payrollMonths.period, `${year}-%`))
      .orderBy(asc(payrollMonths.period))
    return { year, rows, divisions: await listDivisions(db), canApprove: me.role === 'owner' }
  })

export const setPayrollStatusFn = createServerFn({ method: 'POST' })
  .validator(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), status: z.enum(['draft', 'approved']) }))
  .handler(async ({ data }) => {
    const user = await requireRole('owner')
    return setPayrollMonthStatus(getDb(), user.email, data.period, data.status)
  })

export const savePayrollFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/),
      divisionId: z.number().int(),
      netSalary: z.number().nonnegative(),
      bpjsTk: z.number().nonnegative(),
      bpjsKes: z.number().nonnegative(),
      pph21: z.number().nonnegative(),
      headcount: z.number().int().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'hr')
    await recordPayroll(getDb(), user.email, data)
    return { ok: true }
  })

// ------------------------------------------------------------ employees (HR data, owner / hr)

export const getMedicalClaims = createServerFn()
  .validator(yearSchema)
  .handler(async ({ data }) => {
    await requireRole('owner', 'hr')
    const year = String(data.year ?? new Date().getFullYear())
    const { results } = await env.DB.prepare(
      `select id, issue_date, party, description, total, paid, outstanding, status from v_transactions
       where kind = 'reimbursement' and status != 'void' and (category like 'Medical%' or account like 'Medical%') and substr(issue_date, 1, 4) = ?
       order by issue_date desc, id desc`,
    )
      .bind(year)
      .all<{ id: number; issue_date: string; party: string | null; description: string | null; total: number; paid: number; outstanding: number; status: string }>()
    return { claims: results, usage: await medicalUsage(env.DB, Number(year)) }
  })

export const medicalClaimFn = createServerFn({ method: 'POST' })
  .validator(z.object({ employeeId: z.number().int(), amount: z.number().positive(), type: z.string().optional(), date: z.string().optional(), description: z.string().optional() }))
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'hr')
    return recordMedicalClaim(getDb(), user.email, { ...data, createdBy: user.id })
  })

export const getEmployees = createServerFn().handler(async () => {
  await requireRole('owner', 'hr')
  return getDb().select().from(employees).orderBy(asc(employees.name))
})

const employeeFields = z.object({
  name: z.string().min(1),
  position: z.string().nullable().optional(),
  divisionId: z.number().int().nullable().optional(),
  ktp: z.string().nullable().optional(),
  npwp: z.string().nullable().optional(),
  ptkp: z.string().nullable().optional(),
  bpjsTkNo: z.string().nullable().optional(),
  bpjsKesNo: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  bankAccount: z.string().nullable().optional(),
  baseSalary: z.number().int().nonnegative().nullable().optional(),
  medicalLimit: z.number().int().nonnegative().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

/** Add (no id) or update (with id) an employee. Logged like every other change. */
export const saveEmployeeFn = createServerFn({ method: 'POST' })
  .validator(employeeFields.extend({ id: z.number().int().optional() }))
  .handler(async ({ data: { id, ...values } }) => {
    const user = await requireRole('owner', 'hr')
    const db = getDb()
    if (id) {
      const [row] = await db
        .update(employees)
        .set({ ...values, updatedAt: new Date().toISOString() })
        .where(eq(employees.id, id))
        .returning()
      if (!row) throw new Error('employee not found')
      await log(db, user.email, 'update', 'employees', id, { name: row.name, changed: Object.keys(values) })
      return row
    }
    const [row] = await db.insert(employees).values(values).returning()
    await log(db, user.email, 'create', 'employees', row.id, { name: row.name, position: row.position, divisionId: row.divisionId })
    return row
  })

// ------------------------------------------------------------ company opex

export const getCompanyOpex = createServerFn()
  .validator(yearSchema)
  .handler(async ({ data }) => {
    await requireRole('owner', 'finance')
    const year = data.year ?? new Date().getFullYear()
    const db = getDb()
    const budgets = await db.select().from(opexBudgets).where(eq(opexBudgets.fiscalYear, year)).orderBy(asc(opexBudgets.sortOrder))
    const actual = await env.DB.prepare(
      `select coalesce(ac.name, t.category, 'Uncategorised') category, cast(substr(t.issue_date, 6, 2) as integer) m, sum(t.dpp) v
       from transactions t left join accounts ac on ac.id = t.account_id
       where t.direction = 'out' and t.status != 'void' and t.project_id is null and t.kind != 'tax_payment' and substr(t.issue_date, 1, 4) = ?
       group by 1, 2`,
    )
      .bind(String(year))
      .all<{ category: string; m: number; v: number }>()
    const byCat = new Map<string, number[]>()
    for (const r of actual.results) {
      const arr = byCat.get(r.category) ?? Array(12).fill(0)
      arr[r.m - 1] = r.v
      byCat.set(r.category, arr)
    }
    const rows = budgets.map((b) => ({ ...b, months: byCat.get(b.category) ?? Array(12).fill(0) }))
    for (const [category, months] of byCat)
      if (!budgets.some((b) => b.category === category))
        rows.push({ id: 0, category, fiscalYear: year, annualBudget: 0, isFixed: false, sortOrder: 999, months })
    rows.sort((a, b) => b.months.reduce((x, v) => x + v, 0) - a.months.reduce((x, v) => x + v, 0))
    return { year, rows }
  })

export const setOpexBudgetFn = createServerFn({ method: 'POST' })
  .validator(z.object({ category: z.string().min(1), year: z.number().int(), annualBudget: z.number().nonnegative() }))
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'finance')
    return setOpexBudget(getDb(), user.email, data)
  })

// ------------------------------------------------------------ clients

export const getClients = createServerFn().handler(async () => {
  await requireRole('owner', 'finance', 'admin')
  const db = getDb()
  const counts = await db
    .select({ clientId: projects.clientId, n: sql<number>`count(*)` })
    .from(projects)
    .groupBy(projects.clientId)
  const n = new Map(counts.map((c) => [c.clientId, Number(c.n)]))
  return (await listParties(db, 'client')).map((c) => ({ ...c, projects: n.get(c.id) ?? 0 }))
})

const clientFields = z.object({
  name: z.string().min(1),
  legalEntity: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  paymentTermsDays: z.number().int().nonnegative().nullable().optional(),
  npwp: z.string().nullable().optional(),
})

/** Add a client to the client list (or fill in the details of an existing one with that name). */
export const addClientFn = createServerFn({ method: 'POST' })
  .validator(clientFields)
  .handler(async ({ data: { name, ...details } }) => {
    const user = await requireRole('owner', 'finance', 'admin')
    const db = getDb()
    const party = await ensureParty(db, user.email, 'client', name)
    if (!details.code && !party.code) details.code = suggestClientCode(party.name)
    return updateParty(db, user.email, party.id, details)
  })

export const updateClientFn = createServerFn({ method: 'POST' })
  .validator(clientFields.extend({ id: z.number().int() }))
  .handler(async ({ data: { id, ...details } }) => {
    const user = await requireRole('owner', 'finance', 'admin')
    return updateParty(getDb(), user.email, id, details)
  })

// ------------------------------------------------------------ vendors

export const getVendors = createServerFn().handler(async () => {
  await requireRole('owner', 'finance', 'admin')
  const db = getDb()
  const counts = await db
    .select({ partyId: transactions.partyId, n: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.kind, 'vendor_bill'))
    .groupBy(transactions.partyId)
  const n = new Map(counts.map((c) => [c.partyId, Number(c.n)]))
  return (await listParties(db, 'vendor')).map((v) => ({ ...v, bills: n.get(v.id) ?? 0 }))
})

const vendorFields = z.object({
  name: z.string().min(1),
  legalEntity: z.string().nullable().optional(),
  npwp: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  picName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  accountName: z.string().nullable().optional(),
  bankAccount: z.string().nullable().optional(),
})

export const addVendorFn = createServerFn({ method: 'POST' })
  .validator(vendorFields)
  .handler(async ({ data: { name, ...details } }) => {
    const user = await requireRole('owner', 'finance', 'admin')
    const db = getDb()
    const party = await ensureParty(db, user.email, 'vendor', name)
    return Object.values(details).some((v) => v) ? updateParty(db, user.email, party.id, details) : party
  })

export const updateVendorFn = createServerFn({ method: 'POST' })
  .validator(vendorFields.extend({ id: z.number().int() }))
  .handler(async ({ data: { id, ...details } }) => {
    const user = await requireRole('owner', 'finance', 'admin')
    return updateParty(getDb(), user.email, id, details)
  })

// ------------------------------------------------------------ users (owner)

export const getUsers = createServerFn().handler(async () => {
  await requireRole('owner')
  return getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt })
    .from(users)
    .orderBy(asc(users.createdAt))
})

export const setRoleFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.number().int(), role: z.enum(USER_ROLES) }))
  .handler(async ({ data }) => {
    const me = await requireRole('owner')
    if (me.id === data.id && data.role !== 'owner') throw new Error("You can't remove your own owner role")
    await setUserRole(getDb(), me.email, data.id, data.role)
    return { ok: true }
  })

export const addUserFn = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().email(), name: z.string().min(1), role: z.enum(USER_ROLES), password: z.string().min(8) }))
  .handler(async ({ data }) => {
    const me = await requireRole('owner')
    const db = getDb()
    const email = data.email.toLowerCase()
    if (await db.select().from(users).where(eq(users.email, email)).get()) throw new Error('That email already has an account')
    const [row] = await db
      .insert(users)
      .values({ email, name: data.name, role: data.role, passwordHash: await hashPassword(data.password) })
      .returning({ id: users.id })
    await log(db, me.email, 'create', 'users', row.id, { email, role: data.role })
    return { ok: true }
  })

export const divisionsList = createServerFn().handler(async () => {
  await requireRole()
  return getDb().select().from(divisions)
})

export const resetPasswordFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.number().int(), password: z.string().min(8) }))
  .handler(async ({ data }) => {
    const me = await requireRole('owner')
    const db = getDb()
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(data.password) })
      .where(eq(users.id, data.id))
    await log(db, me.email, 'reset_password', 'users', data.id)
    return { ok: true }
  })

// ------------------------------------------------------------ audit log (owner)

export const getActivity = createServerFn()
  .validator(
    z.object({
      entity: z.string().optional(),
      source: z.enum(['web', 'mcp', 'import']).optional(),
      actor: z.string().optional(),
      batchId: z.string().optional(),
      before: z.number().int().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireRole('owner')
    const rows = await listActivity(getDb(), { ...data, limit: 100 })
    return rows.map((r) => ({ ...r, data: r.data == null ? null : JSON.stringify(r.data) }))
  })

// ---------------------------------------------------------------- companies (PTs) and divisions

export const getCompanies = createServerFn().handler(async () => {
  await requireRole('owner', 'finance')
  const db = getDb()
  const used = await db
    .select({ divisionId: projects.divisionId, n: sql<number>`count(*)` })
    .from(projects)
    .groupBy(projects.divisionId)
  const n = new Map(used.map((u) => [u.divisionId, Number(u.n)]))
  const divs = (await listDivisions(db)).map((d) => ({ ...d, projects: n.get(d.id) ?? 0 }))
  return (await listCompanies(db)).map((c) => ({ ...c, divisions: divs.filter((d) => d.companyId === c.id) }))
})

const companyFields = z.object({ name: z.string().min(1), code: z.string().nullable(), npwp: z.string().nullable(), address: z.string().nullable() })

export const addCompanyFn = createServerFn({ method: 'POST' })
  .validator(companyFields)
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'finance')
    return createCompany(getDb(), user.email, data)
  })

export const updateCompanyFn = createServerFn({ method: 'POST' })
  .validator(companyFields.extend({ id: z.number().int() }))
  .handler(async ({ data: { id, ...rest } }) => {
    const user = await requireRole('owner', 'finance')
    return updateCompany(getDb(), user.email, id, rest)
  })

export const addDivisionFn = createServerFn({ method: 'POST' })
  .validator(z.object({ companyId: z.number().int(), name: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'finance')
    return createDivision(getDb(), user.email, data)
  })

export const renameDivisionFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.number().int(), name: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'finance')
    return updateDivision(getDb(), user.email, data.id, { name: data.name })
  })

// ---------------------------------------------------------------- tax

export const getTax = createServerFn()
  .validator(z.object({ year: z.number().int().optional(), period: filterSearch.shape.period, companyId: z.number().int().optional() }))
  .handler(async ({ data }) => {
    await requireRole('owner', 'finance')
    const db = getDb()
    const companies = await listCompanies(db)
    const companyId = data.companyId ?? companies.find((c) => c.code === 'SRI')?.id ?? companies[0]?.id ?? 1
    const year = data.year ?? new Date().getFullYear()
    const rows = await taxDue(env.DB, companyId, year)
    const payments = (
      await env.DB.prepare(
        `select t.id, t.category type, t.tax_period period, t.total amount, t.issue_date date, t.number, t.description from transactions t
         where t.kind = 'tax_payment' and t.status != 'void' and t.company_id = ? and substr(t.tax_period, 1, 4) = ? order by t.tax_period, t.issue_date`,
      )
        .bind(companyId, String(year))
        .all<{ id: number; type: string; period: string; amount: number; date: string; number: string | null; description: string | null }>()
    ).results
    // A quarter or month keeps only those tax months.
    const { from, to } = rangeOf({ year, period: data.period })
    const inRange = (p: string) => p >= from!.slice(0, 7) && p <= to!.slice(0, 7)
    return {
      companies,
      companyId,
      year,
      period: data.period,
      rows: rows.filter((r) => inRange(r.period)),
      payments: payments.filter((p) => inRange(p.period)),
      today: new Date().toISOString().slice(0, 10),
    }
  })

export const recordTaxPaymentFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      companyId: z.number().int(),
      taxType: z.enum(TAX_TYPES),
      period: z.string(),
      amount: z.number().positive(),
      date: z.string().optional(),
      number: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'finance')
    return recordTaxPayment(getDb(), user.email, { ...data, createdBy: user.id })
  })

// ---------------------------------------------------------------- P&L by chart of accounts

export const getPnl = createServerFn()
  .validator(filterSearch)
  .handler(async ({ data }) => {
    await requireRole('owner', 'finance')
    const db = getDb()
    const companies = await listCompanies(db)
    const company = companies.find((c) => c.code === 'SRI') ?? companies[0]
    const f = toListFilter(data)
    return { company, from: f.from, to: f.to, ...(await pnlByAccount(env.DB, company.id, f)) }
  })

// ---------------------------------------------------------------- Buku Besar (general ledger)

export const getLedger = createServerFn()
  .validator(filterSearch)
  .handler(async ({ data }) => {
    await requireRole('owner', 'finance')
    const companies = await listCompanies(getDb())
    const company = companies.find((c) => c.code === 'SRI') ?? companies[0]
    const f = toListFilter(data)
    const { generalLedger } = await import('#/lib/ledger')
    return { company, from: f.from, to: f.to, ...(await generalLedger(env.DB, company.id, f)) }
  })

// ---------------------------------------------------------------- balance sheet

/** As of the end of the filter's period (today if that is later, or with no period). */
export const getBalanceSheet = createServerFn()
  .validator(filterSearch)
  .handler(async ({ data }) => {
    await requireRole('owner', 'finance')
    const companies = await listCompanies(getDb())
    const company = companies.find((c) => c.code === 'SRI') ?? companies[0]
    const today = new Date().toISOString().slice(0, 10)
    const to = rangeOf(data).to
    const asOf = to && to < today ? to : today
    return { company, ...(await balanceSheet(env.DB, company.id, asOf)) }
  })

const amount = z.number().finite()
export const setOpeningBalancesFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      companyId: z.number().int(),
      asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      cash: amount,
      receivables: amount,
      otherAssets: amount,
      payables: amount,
      taxPayable: amount,
      otherLiabilities: amount,
      shareCapital: amount,
      retainedEarnings: amount,
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'finance')
    const { companyId, ...rest } = data
    return setOpeningBalances(getDb(), user.email, companyId, rest)
  })
