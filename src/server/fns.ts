/** Server functions for the web UI. Same finance operations as the MCP tools. */
import { createServerFn } from '@tanstack/react-start'
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { and, eq, gt, sql } from 'drizzle-orm'
import { z } from 'zod'

import { PPH_TYPES, PROJECT_TYPES, TRANSACTION_KINDS, TRANSACTION_STATUSES, activityLog, users } from '#/db/schema'
import { SESSION_COOKIE, SESSION_DAYS, readSession, signSession, verifyPassword } from '#/lib/auth'
import { getDb } from '#/lib/db'
import {
  addBudgetLine,
  createProject,
  findProject,
  listDivisions,
  listCompanies,
  listOpexCategories,
  listProjects,
  listTransactions,
  payablesDue,
  projectBudget,
  recordPayment,
  recordTransaction,
  setTransactionStatus,
  decideApproval,
  listApprovals,
  submitBudget,
} from '#/lib/finance'

async function currentUser() {
  const id = await readSession(getCookie(SESSION_COOKIE), env.SESSION_SECRET)
  if (!id) return null
  const user = await getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .get()
  return user ?? null
}

/** Signed-in user. HR only sees payroll (Employee OpEx), so finance data refuses the hr role unless allowHr. */
async function requireUser(allowHr = false) {
  const user = await currentUser()
  if (!user) throw new Error('Not signed in')
  if (user.role === 'hr' && !allowHr) throw new Error("You don't have access to this section")
  return user
}

export const getMe = createServerFn().handler(() => currentUser())

export const login = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    const db = getDb()
    const email = data.email.toLowerCase()
    // Lock an email for 15 minutes after 5 failed attempts (failures are kept in activity_log).
    const since = new Date(Date.now() - 15 * 60_000).toISOString()
    const fails = await db
      .select({ n: sql<number>`count(*)` })
      .from(activityLog)
      .where(and(eq(activityLog.action, 'login_failed'), eq(activityLog.actor, email), gt(activityLog.at, since)))
      .get()
    if (Number(fails?.n ?? 0) >= 5) return { ok: false as const, error: 'Too many failed attempts. Try again in 15 minutes.' }
    const user = await db.select().from(users).where(eq(users.email, email)).get()
    if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
      await db.insert(activityLog).values({ actor: email, action: 'login_failed', entity: 'users', entityId: user?.id ?? 0 })
      return { ok: false as const, error: 'Wrong email or password' }
    }
    setCookie(SESSION_COOKIE, await signSession(user.id, env.SESSION_SECRET), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_DAYS * 86_400,
    })
    return { ok: true as const }
  })

export const logout = createServerFn({ method: 'POST' }).handler(() => {
  deleteCookie(SESSION_COOKIE, { path: '/' })
  return { ok: true }
})

// ---------------------------------------------------------------- reads

export const getDashboard = createServerFn().handler(async () => {
  await requireUser()
  const db = getDb()
  const projects = await listProjects(db)
  const today = new Date().toISOString().slice(0, 10)
  const inTx = await listTransactions(env.DB, { direction: 'in', limit: 1000 })
  const live = inTx.filter((t) => t.status !== 'void')
  const friday = new Date()
  friday.setDate(friday.getDate() + ((5 - friday.getDay() + 7) % 7))
  const weekEnd = friday.toISOString().slice(0, 10)
  const due = await payablesDue(env.DB, weekEnd)
  const overdue = live.filter((t) => t.overdue).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
  const recent = await listTransactions(env.DB, { limit: 8 })
  return {
    today,
    weekEnd,
    projects,
    billing: live.reduce((a, t) => a + t.dpp, 0),
    collected: live.reduce((a, t) => a + t.paid, 0),
    receivable: live.reduce((a, t) => a + t.outstanding, 0),
    overdue: { count: overdue.length, amount: overdue.reduce((a, t) => a + t.outstanding, 0), items: overdue.slice(0, 5) },
    payables: { amount: due.totalOutstanding, count: due.items.length, items: due.items.slice(0, 5) },
    recent,
  }
})

export const getReference = createServerFn().handler(async () => {
  await requireUser(true)
  const db = getDb()
  return { divisions: await listDivisions(db), companies: await listCompanies(db), categories: await listOpexCategories(db) }
})

export const getProjects = createServerFn().handler(async () => {
  await requireUser()
  return listProjects(getDb())
})

export const getProject = createServerFn()
  .validator(z.object({ code: z.string() }))
  .handler(async ({ data }) => {
    await requireUser()
    const db = getDb()
    const project = await findProject(db, data.code)
    return {
      project,
      budget: await projectBudget(db, project.id),
      transactions: await listTransactions(env.DB, { projectId: project.id }),
    }
  })

export const getTransactions = createServerFn()
  .validator(z.object({ openOnly: z.boolean().optional(), direction: z.enum(['in', 'out']).optional() }))
  .handler(async ({ data }) => {
    await requireUser()
    return listTransactions(env.DB, data)
  })

export const getPayables = createServerFn()
  .validator(z.object({ dueBy: z.string() }))
  .handler(async ({ data }) => {
    await requireUser()
    return payablesDue(env.DB, data.dueBy)
  })

// ---------------------------------------------------------------- writes

export const createProjectFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      clientName: z.string().min(1),
      divisionId: z.number().int(),
      type: z.enum(PROJECT_TYPES),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    return createProject(getDb(), user.email, data)
  })

export const addBudgetLineFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      projectId: z.number().int(),
      name: z.string().min(1),
      charge: z.number(),
      maxExpense: z.number(),
      asfAmount: z.number().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    return addBudgetLine(getDb(), user.email, data)
  })

export const recordTransactionFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      kind: z.enum(TRANSACTION_KINDS),
      projectId: z.number().int().nullable().optional(),
      budgetLineId: z.number().int().nullable().optional(),
      companyId: z.number().int().nullable().optional(),
      partyName: z.string().optional(),
      category: z.string().optional(),
      description: z.string().optional(),
      number: z.string().optional(),
      issueDate: z.string().optional(),
      dueDate: z.string().optional(),
      dpp: z.number().nonnegative(),
      withPpn: z.boolean().optional(),
      pphType: z.enum(PPH_TYPES).optional(),
      pph: z.number().optional(),
      status: z.enum(TRANSACTION_STATUSES).optional(),
      requestedBy: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    return recordTransaction(getDb(), user.email, { ...data, source: 'web', createdBy: user.id })
  })

export const setStatusFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.number().int(), status: z.enum(TRANSACTION_STATUSES) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    return setTransactionStatus(getDb(), user.email, data.id, data.status)
  })

export const recordPaymentFn = createServerFn({ method: 'POST' })
  .validator(z.object({ transactionId: z.number().int(), amount: z.number().optional(), date: z.string().optional() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    return recordPayment(getDb(), user.email, { ...data, createdBy: user.id })
  })

export const getApprovals = createServerFn()
  .validator(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    return { canDecide: user.role === 'owner', approvals: await listApprovals(getDb(), { status: data.status ?? 'pending', limit: 100 }) }
  })

export const decideApprovalFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.number().int(), decision: z.enum(['approve', 'reject']), note: z.string().optional() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (user.role !== 'owner') throw new Error('Only the owner can approve or reject')
    return decideApproval(getDb(), user.email, data.id, data.decision, data.note)
  })

export const submitBudgetFn = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: z.number().int() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    return submitBudget(getDb(), user.email, data.projectId)
  })
