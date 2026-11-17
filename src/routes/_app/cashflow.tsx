import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'

import { MONTHS, PageHeader, Stat } from '#/components/ui'
import { rp, rpShort } from '#/lib/format'
import { getCashflow } from '#/server/pages'
import { Select } from '#/components/dialogs'

export const Route = createFileRoute('/_app/cashflow')({
  validateSearch: z.object({ year: z.coerce.number().int().optional() }),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: ({ deps }) => getCashflow({ data: { year: deps.year } }),
  component: Cashflow,
})

function Cashflow() {
  const d = Route.useLoaderData()
  const navigate = useNavigate()
  const [hover, setHover] = useState<number | null>(null)
  const peak = Math.max(1, ...d.inM, ...d.outM)
  return (
    <>
      <PageHeader title="Cash Flow" sub="Cash that actually moved (payments), and client money still expected." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Total Collected" value={rpShort(d.collected)} sub="payments received" tone="good" />
        <Stat label="Total Expenses Paid Out" value={rpShort(d.paidOut)} sub="paid to vendors and staff" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Overdue now"
          value={rpShort(d.overdue)}
          sub={`${d.overdueCount} client invoices past due`}
          tone={d.overdue ? 'bad' : undefined}
        />
        <Stat label="Due in next 30 days" value={rpShort(d.next30)} sub="expected incoming" tone="accent" />
        <Stat label="Due in next 90 days" value={rpShort(d.next90)} sub="expected incoming" tone="accent" />
        <Stat label="Due in next 180 days" value={rpShort(d.next180)} sub="expected incoming" tone="accent" />
      </div>
      <p className="mt-2 text-[12px] text-muted">
        Expected incoming counts unpaid client invoices by due date. Overdue ones are shown separately; contract value not yet invoiced is
        on Invoicing → Uninvoiced Balance.
      </p>

      <div className="card mt-10 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-semibold">Monthly cash flow</h2>
            <Select
              value={String(d.year)}
              onChange={(v) => navigate({ to: '/cashflow', search: { year: Number(v) } })}
              options={d.years.map((y) => ({ value: String(y), label: String(y) }))}
            />
          </div>
          <div className="flex gap-4 text-[12px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-good" /> Cash in
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-ink-2/40" /> Cash out
            </span>
          </div>
        </div>
        <div className="relative flex h-56 items-end gap-1 sm:gap-2" onMouseLeave={() => setHover(null)}>
          {MONTHS.map((m, i) => {
            const net = d.inM[i] - d.outM[i]
            const active = hover === i
            return (
              <div
                key={m}
                className={`relative flex h-full flex-1 cursor-default flex-col items-center gap-1.5 rounded ${active ? 'bg-ink-2/5' : ''}`}
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(active ? null : i)}
              >
                <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                  <div
                    className={`w-1/2 max-w-4 rounded-t bg-good ${hover !== null && !active ? 'opacity-40' : ''}`}
                    style={{ height: `${(d.inM[i] / peak) * 100}%` }}
                  />
                  <div
                    className={`w-1/2 max-w-4 rounded-t bg-ink-2/40 ${hover !== null && !active ? 'opacity-40' : ''}`}
                    style={{ height: `${(d.outM[i] / peak) * 100}%` }}
                  />
                </div>
                <div className={`text-[11px] ${active ? 'font-semibold text-ink' : 'text-muted'}`}>{m}</div>
                {active && (
                  <div
                    className={`pointer-events-none absolute top-0 z-10 w-48 rounded-lg border border-line bg-surface p-3 text-[12px] shadow-lg ${
                      i < 6 ? 'left-full ml-1' : 'right-full mr-1'
                    }`}
                  >
                    <div className="mb-1.5 font-semibold">
                      {m} {d.year}
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-ink-2">Cash in</span>
                      <span className="num text-good">{rp(d.inM[i])}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-ink-2">Cash out</span>
                      <span className="num">{rp(d.outM[i])}</span>
                    </div>
                    <div className="mt-1.5 flex justify-between gap-2 border-t border-line pt-1.5 font-semibold">
                      <span>Net</span>
                      <span className={`num ${net >= 0 ? 'text-good' : 'text-bad'}`}>{rp(net)}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <h2 className="mb-3 mt-10 text-[15px] font-semibold">Cash position by project</h2>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Client / Project</th>
              <th className="th num">Invoiced</th>
              <th className="th num">Collected</th>
              <th className="th num">Paid Out</th>
              <th className="th num">Net Position</th>
            </tr>
          </thead>
          <tbody>
            {d.byProject.map((p) => (
              <tr key={p.code} className="cursor-pointer" onClick={() => navigate({ to: '/projects/$code', params: { code: p.code } })}>
                <td className="td">
                  <div className="font-medium">{p.client}</div>
                  <div className="text-[12px] text-muted">{p.name}</div>
                </td>
                <td className="td num">{rp(p.invoiced)}</td>
                <td className="td num">{rp(p.collected)}</td>
                <td className="td num">{rp(p.paid_out)}</td>
                <td className={`td num font-semibold ${p.collected - p.paid_out >= 0 ? 'text-good' : 'text-bad'}`}>
                  {rp(p.collected - p.paid_out)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
