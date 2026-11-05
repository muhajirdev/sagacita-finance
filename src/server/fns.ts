/** Server functions for the web UI. Same finance operations as the MCP tools. */
import { createServerFn } from '@tanstack/react-start'
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { PPH_TYPES, PROJECT_TYPES, TRANSACTION_KINDS, TRANSACTION_STATUSES, users } from '#/db/schema'
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

async function requireUser() {
  const user = await currentUser()
  if (!user) throw new Error('Not signed in')
  return user
}

export const getMe = createServerFn().handler(() => currentUser())

export const login = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await getDb().select().from(users).where(eq(users.email, data.email.toLowerCase())).get()
    if (!user || !(await verifyPassword(data.password, user.passwordHash)))
      return { ok: false as const, error: 'Wrong email or password' }
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
  const due = await payablesDue(env.DB, today)
  return {
    projects,
    billing: live.reduce((a, t) => a + t.dpp, 0),
    collected: live.reduce((a, t) => a + t.paid, 0),
    overdueInvoices: live.filter((t) => t.overdue).length,
    overBudget: projects.filter((p) => p.totals.usedPct > 100).length,
    payablesToday: due.totalOutstanding,
  }
})

export const getReference = createServerFn().handler(async () => {
  await requireUser()
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
