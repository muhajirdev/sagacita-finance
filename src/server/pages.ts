/** Server functions for the reporting / admin pages carried over from the original app. */
import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { asc, eq, like, sql } from 'drizzle-orm'
import { z } from 'zod'

import { PPH_TYPES, PROJECT_TYPES, USER_ROLES, divisions, opexBudgets, payrollMonths, projects, users } from '#/db/schema'
import { SESSION_COOKIE, hashPassword, readSession } from '#/lib/auth'
import { getDb } from '#/lib/db'
import {
  deleteBudgetLine,
  ensureParty,
  listDivisions,
  listParties,
  listProjects,
  listTransactions,
  updateBudgetLine,
  setOpexBudget,
  setUserRole,
  updateProject,
  updateTransaction,
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
      clientName: z.string().optional(),
      divisionId: z.number().int().optional(),
      type: z.enum(PROJECT_TYPES).optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
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

export const getInvoicing = createServerFn().handler(async () => {
  await requireRole('owner', 'finance')
  const db = getDb()
  const [invoices, ps] = await Promise.all([listTransactions(env.DB, { direction: 'in', limit: 1000 }), listProjects(db)])
  return { invoices, projects: ps }
})

export const getExpenses = createServerFn().handler(async () => {
  await requireRole('owner', 'finance', 'admin')
  return listTransactions(env.DB, { direction: 'out', limit: 1000 })
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
  .validator(yearSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'finance')
    const year = data.year ?? new Date().getFullYear()
    const db = getDb()
    const ps = await listProjects(db)
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
        .where(like(payrollMonths.period, `${year}-%`))
        .get()
      const opex = await env.DB.prepare(
        `select coalesce(sum(dpp), 0) v from transactions where direction = 'out' and status != 'void' and project_id is null and substr(issue_date, 1, 4) = ?`,
      )
        .bind(String(year))
        .first<{ v: number }>()
      owner = {
        projectExpenses: rows.reduce((a, r) => a + r.actualExp, 0),
        employeeOpex: Number(pay?.v ?? 0),
        companyOpex: Number(opex?.v ?? 0),
      }
    }
    return { year, rows, owner }
  })

// ------------------------------------------------------------ cash flow

export const getCashflow = createServerFn()
  .validator(yearSchema)
  .handler(async ({ data }) => {
    await requireRole('owner', 'finance')
    const year = data.year ?? new Date().getFullYear()
    const d1 = env.DB
    const totals = await d1
      .prepare(`select direction, coalesce(sum(amount), 0) v from payments group by direction`)
      .all<{ direction: 'in' | 'out'; v: number }>()
    const monthly = await d1
      .prepare(
        `select cast(substr(date, 6, 2) as integer) m, direction, coalesce(sum(amount), 0) v
         from payments where substr(date, 1, 4) = ? group by m, direction`,
      )
      .bind(String(year))
      .all<{ m: number; direction: 'in' | 'out'; v: number }>()
    const horizon = async (days: number) =>
      (
        await d1
          .prepare(
            `select coalesce(sum(outstanding), 0) v from v_transactions
             where direction = 'in' and status != 'void' and outstanding > 0
               and due_date >= date('now') and due_date <= date('now', ?)`,
          )
          .bind(`+${days} days`)
          .first<{ v: number }>()
      )?.v ?? 0
    const byProject = await d1
      .prepare(
        `select p.code, p.name, c.name client,
           (select coalesce(sum(total), 0) from transactions t where t.project_id = p.id and t.direction = 'in' and t.status != 'void') invoiced,
           (select coalesce(sum(y.amount), 0) from payments y join transactions t on t.id = y.transaction_id where t.project_id = p.id and y.direction = 'in') collected,
           (select coalesce(sum(y.amount), 0) from payments y join transactions t on t.id = y.transaction_id where t.project_id = p.id and y.direction = 'out') paid_out
         from projects p join parties c on c.id = p.client_id order by p.code`,
      )
      .all<{ code: string; name: string; client: string; invoiced: number; collected: number; paid_out: number }>()
    const inM = Array(12).fill(0) as number[]
    const outM = Array(12).fill(0) as number[]
    for (const r of monthly.results) (r.direction === 'in' ? inM : outM)[r.m - 1] = r.v
    const total = (dir: 'in' | 'out') => totals.results.find((r) => r.direction === dir)?.v ?? 0
    const overdue = await d1
      .prepare(
        `select coalesce(sum(outstanding), 0) v, count(*) n from v_transactions
         where direction = 'in' and status != 'void' and overdue = 1`,
      )
      .first<{ v: number; n: number }>()
    return {
      year,
      overdue: overdue?.v ?? 0,
      overdueCount: overdue?.n ?? 0,
      collected: total('in'),
      paidOut: total('out'),
      next30: await horizon(30),
      next90: await horizon(90),
      next180: await horizon(180),
      inM,
      outM,
      byProject: byProject.results,
    }
  })

// ------------------------------------------------------------ employee opex (payroll, owner / hr)

export const getPayroll = createServerFn()
  .validator(yearSchema)
  .handler(async ({ data }) => {
    await requireRole('owner', 'hr')
    const year = data.year ?? new Date().getFullYear()
    const db = getDb()
    const rows = await db
      .select()
      .from(payrollMonths)
      .where(like(payrollMonths.period, `${year}-%`))
      .orderBy(asc(payrollMonths.period))
    return { year, rows, divisions: await listDivisions(db) }
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
    await requireRole('owner', 'hr')
    const db = getDb()
    const values = { ...data, headcount: data.headcount ?? null }
    await db
      .insert(payrollMonths)
      .values(values)
      .onConflictDoUpdate({ target: [payrollMonths.period, payrollMonths.divisionId], set: values })
    return { ok: true }
  })

// ------------------------------------------------------------ company opex

export const getCompanyOpex = createServerFn()
  .validator(yearSchema)
  .handler(async ({ data }) => {
    await requireRole('owner', 'hr', 'finance')
    const year = data.year ?? new Date().getFullYear()
    const db = getDb()
    const budgets = await db.select().from(opexBudgets).where(eq(opexBudgets.fiscalYear, year)).orderBy(asc(opexBudgets.sortOrder))
    const actual = await env.DB.prepare(
      `select coalesce(category, 'Uncategorised') category, cast(substr(issue_date, 6, 2) as integer) m, sum(dpp) v
       from transactions where direction = 'out' and status != 'void' and project_id is null and substr(issue_date, 1, 4) = ?
       group by category, m`,
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
  await requireRole()
  const db = getDb()
  const counts = await db
    .select({ clientId: projects.clientId, n: sql<number>`count(*)` })
    .from(projects)
    .groupBy(projects.clientId)
  const n = new Map(counts.map((c) => [c.clientId, Number(c.n)]))
  return (await listParties(db, 'client')).map((c) => ({ ...c, projects: n.get(c.id) ?? 0 }))
})

export const addClientFn = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await requireRole('owner', 'finance', 'admin')
    return ensureParty(getDb(), user.email, 'client', data.name)
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
    await requireRole('owner')
    const db = getDb()
    const email = data.email.toLowerCase()
    if (await db.select().from(users).where(eq(users.email, email)).get()) throw new Error('That email already has an account')
    await db.insert(users).values({ email, name: data.name, role: data.role, passwordHash: await hashPassword(data.password) })
    return { ok: true }
  })

export const divisionsList = createServerFn().handler(async () => {
  await requireRole()
  return getDb().select().from(divisions)
})

export const resetPasswordFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.number().int(), password: z.string().min(8) }))
  .handler(async ({ data }) => {
    await requireRole('owner')
    await getDb()
      .update(users)
      .set({ passwordHash: await hashPassword(data.password) })
      .where(eq(users.id, data.id))
    return { ok: true }
  })
