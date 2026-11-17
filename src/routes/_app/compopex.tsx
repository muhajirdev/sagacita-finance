import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'

import { TransactionForm } from '#/components/transactions'
import { MONTHS, Modal, PageHeader, Stat, UsageBar } from '#/components/ui'
import { rp, rpShort } from '#/lib/format'
import { getReference } from '#/server/fns'
import { getCompanyOpex, setOpexBudgetFn } from '#/server/pages'
import { Select, ui } from '#/components/dialogs'

export const Route = createFileRoute('/_app/compopex')({
  validateSearch: z.object({ year: z.coerce.number().int().optional() }),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: async ({ deps }) => ({ opex: await getCompanyOpex({ data: { year: deps.year } }), ref: await getReference() }),
  component: CompanyOpex,
})

function CompanyOpex() {
  const { opex, ref } = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [record, setRecord] = useState(false)
  const month = new Date().getFullYear() === opex.year ? new Date().getMonth() + 1 : 12
  const rows = opex.rows.map((r) => {
    const ytd = r.months.reduce((a, v) => a + v, 0)
    const budgetYtd = r.isFixed ? (r.annualBudget / 12) * month : r.annualBudget
    return { ...r, ytd, usedPct: r.annualBudget ? Math.round((ytd / r.annualBudget) * 1000) / 10 : 0, budgetYtd }
  })
  const budget = rows.reduce((a, r) => a + r.annualBudget, 0)
  const ytd = rows.reduce((a, r) => a + r.ytd, 0)

  return (
    <>
      <PageHeader
        title="Internal OpEx"
        sub="Household / office spend with no project (rent, utilities, supplies, subscriptions...), by COA, against the annual budget. Before tax."
        right={
          <div className="flex items-center gap-3">
            <div className="w-28">
              <Select
                value={String(opex.year)}
                onChange={(v) => navigate({ search: { year: Number(v) } })}
                options={[opex.year - 1, opex.year, opex.year + 1].map((y) => ({ value: String(y), label: String(y) }))}
              />
            </div>
            <button className="btn" onClick={() => setRecord(true)}>
              + Record internal spend
            </button>
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={`Annual budget ${opex.year}`} value={rpShort(budget)} />
        <Stat label="Actual YTD" value={rpShort(ytd)} sub={`${budget ? ((ytd / budget) * 100).toFixed(1) : 0}% of budget`} />
        <Stat label="Remaining" value={rpShort(budget - ytd)} tone={budget - ytd < 0 ? 'bad' : 'accent'} />
      </div>

      <div className="card mt-10 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Category</th>
              <th className="th num">Annual Budget</th>
              {MONTHS.map((m) => (
                <th key={m} className="th num">
                  {m}
                </th>
              ))}
              <th className="th num">YTD</th>
              <th className="th">Used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category}>
                <td className="td whitespace-nowrap font-medium">
                  {r.category} {r.isFixed && <span className="pill-neutral ml-1">fixed</span>}
                </td>
                <td className="td num">
                  <button
                    className="tabular-nums hover:text-accent"
                    title="Change budget"
                    onClick={async () => {
                      const v = await ui.prompt(`${r.category} budget`, [
                        {
                          name: 'budget',
                          label: `Annual budget ${opex.year} (IDR)`,
                          type: 'number',
                          min: 0,
                          defaultValue: String(r.annualBudget),
                        },
                      ])
                      if (!v) return
                      if (
                        await ui.run(
                          () => setOpexBudgetFn({ data: { category: r.category, year: opex.year, annualBudget: Number(v.budget) } }),
                          'Budget saved',
                        )
                      )
                        await router.invalidate()
                    }}
                  >
                    {rp(r.annualBudget)}
                  </button>
                </td>
                {r.months.map((v, i) => (
                  <td key={i} className="td num text-[12px] text-ink-2">
                    {v ? rpShort(v).replace('Rp ', '') : '—'}
                  </td>
                ))}
                <td className="td num font-medium">{rp(r.ytd)}</td>
                <td className="td">
                  {r.annualBudget ? <UsageBar pct={r.usedPct} /> : <span className="text-[12px] text-muted">no budget</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-muted">Click a budget to change it. Monthly cells: M = million (juta), B = billion (miliar).</p>

      {record && (
        <Modal title="Record internal spend" onClose={() => setRecord(false)}>
          <TransactionForm companies={ref.companies} categories={ref.categories} />
          <div className="mt-3 text-right">
            <button
              className="btn-ghost py-2"
              onClick={async () => {
                setRecord(false)
                await router.invalidate()
              }}
            >
              Done
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
