import { createFileRoute } from '@tanstack/react-router'

import { MONTHS, PageHeader, Stat } from '#/components/ui'
import { rp, rpShort } from '#/lib/format'
import { getCashflow } from '#/server/pages'

export const Route = createFileRoute('/_app/cashflow')({
  loader: () => getCashflow({ data: {} }),
  component: Cashflow,
})

function Cashflow() {
  const d = Route.useLoaderData()
  const peak = Math.max(1, ...d.inM, ...d.outM)
  return (
    <>
      <PageHeader title="Cash Flow" sub="Cash that actually moved (payments), and client money still expected." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Total Collected" value={rpShort(d.collected)} sub="payments received" tone="good" />
        <Stat label="Total Expenses Paid Out" value={rpShort(d.paidOut)} sub="paid to vendors and staff" />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Next 30 days" value={rpShort(d.next30)} sub="expected incoming" tone="accent" />
        <Stat label="Next 90 days" value={rpShort(d.next90)} sub="expected incoming" tone="accent" />
        <Stat label="Next 180 days" value={rpShort(d.next180)} sub="expected incoming" tone="accent" />
      </div>

      <div className="card mt-10 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Monthly cash flow · {d.year}</h2>
          <div className="flex gap-4 text-[12px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-good" /> Cash in
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-ink-2/40" /> Cash out
            </span>
          </div>
        </div>
        <div className="flex h-56 items-end gap-1 sm:gap-2">
          {MONTHS.map((m, i) => (
            <div key={m} className="flex h-full flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                <div
                  className="w-1/2 max-w-4 rounded-t bg-good"
                  style={{ height: `${(d.inM[i] / peak) * 100}%` }}
                  title={`In: ${rp(d.inM[i])}`}
                />
                <div
                  className="w-1/2 max-w-4 rounded-t bg-ink-2/40"
                  style={{ height: `${(d.outM[i] / peak) * 100}%` }}
                  title={`Out: ${rp(d.outM[i])}`}
                />
              </div>
              <div className="text-[11px] text-muted">{m}</div>
            </div>
          ))}
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
              <tr key={p.code}>
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
