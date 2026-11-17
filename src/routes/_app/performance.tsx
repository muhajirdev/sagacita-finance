import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { PageHeader, Stat, pct } from '#/components/ui'
import { rp, rpShort } from '#/lib/format'
import { getPerformance } from '#/server/pages'
import { getReference } from '#/server/fns'
import { rangeOf } from '#/lib/filters'
import { FilterBar } from '#/components/filter-bar'
import { filterSearch, pickFilters } from '#/lib/filters'

export const Route = createFileRoute('/_app/performance')({
  validateSearch: filterSearch,
  loaderDeps: ({ search }) => pickFilters(search),
  loader: async ({ deps }) => {
    const [d, ref] = await Promise.all([getPerformance({ data: deps }), getReference()])
    return { ...d, ref }
  },
  component: Performance,
})

function Performance() {
  const { rows, owner, ref } = Route.useLoaderData()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const go = Route.useNavigate()
  const range = rangeOf(search)
  const period = range.from || range.to ? `${range.from ?? '…'} to ${range.to ?? '…'}` : 'All years'
  const sum = (k: 'billing' | 'allocExp' | 'actualExp') => rows.reduce((a, r) => a + r[k], 0)
  const billing = sum('billing')
  const estExp = sum('allocExp')
  const actExp = sum('actualExp')
  return (
    <>
      <PageHeader title="Performance" sub="Billing is the contract value or the amount invoiced, whichever is higher, before VAT." />
      <FilterBar value={pickFilters(search)} lists={ref} onChange={(f) => go({ search: (prev) => ({ ...prev, ...f }) })} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total Billing (net)" value={rpShort(billing)} sub="contracted / invoiced, pre-VAT" />
        <Stat label="Estimated Expenses" value={rpShort(estExp)} sub="sum of all SOW max expense + ASF" />
        <Stat label="Estimated Net Revenue" value={rpShort(billing - estExp)} sub="billing − estimated expenses" tone="accent" />
      </div>

      <h2 className="mb-3 mt-10 text-[15px] font-semibold">By project</h2>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Client / Project</th>
              <th className="th">Division</th>
              <th className="th num">Billing</th>
              <th className="th num">Alloc Exp</th>
              <th className="th num">Est Margin</th>
              <th className="th num">Est %</th>
              <th className="th num">Actual Exp</th>
              <th className="th num">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer" onClick={() => navigate({ to: '/budget', search: { project: r.code } })}>
                <td className="td">
                  <div className="font-medium">{r.client}</div>
                  <div className="text-[12px] text-muted">{r.name}</div>
                </td>
                <td className="td whitespace-nowrap">{r.division}</td>
                <td className="td num">{rp(r.billing)}</td>
                <td className="td num">{rp(r.allocExp)}</td>
                <td className="td num">{rp(r.estMargin)}</td>
                <td className="td num">{pct(r.estPct)}</td>
                <td className="td num">{rp(r.actualExp)}</td>
                <td className={`td num ${r.margin < 0 ? 'text-bad' : ''}`}>{rp(r.margin)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-canvas/60 font-semibold">
              <td className="td">TOTAL</td>
              <td className="td" />
              <td className="td num">{rp(billing)}</td>
              <td className="td num">{rp(estExp)}</td>
              <td className="td num">{rp(billing - estExp)}</td>
              <td className="td" />
              <td className="td num">{rp(actExp)}</td>
              <td className="td num">{rp(billing - actExp)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {owner && (
        <>
          <h2 className="mb-3 mt-10 text-[15px] font-semibold">
            Net Profit Summary <span className="text-[12px] font-normal text-muted">· Owner view · {period}</span>
          </h2>
          <div className="card max-w-xl divide-y divide-line text-[14px]">
            <Line label="Total Billing" value={billing} />
            <Line label="− Project Expenses" value={-owner.projectExpenses} muted />
            <Line label="= Revenue" value={billing - owner.projectExpenses} strong />
            <Line label="− Employee OpEx (YTD)" value={-owner.employeeOpex} muted />
            <Line label="= Operating Profit / EBITDA" value={billing - owner.projectExpenses - owner.employeeOpex} strong />
            <Line label="− Internal OpEx (YTD)" value={-owner.companyOpex} muted />
            <Line
              label="= Estimated Net Profit (before tax)"
              value={billing - owner.projectExpenses - owner.employeeOpex - owner.companyOpex}
              total
            />
          </div>
        </>
      )}
    </>
  )
}

function Line({
  label,
  value,
  muted,
  strong,
  total,
}: {
  label: string
  value: number
  muted?: boolean
  strong?: boolean
  total?: boolean
}) {
  return (
    <div
      className={`flex justify-between px-5 py-3 ${muted ? 'text-ink-2' : ''} ${strong ? 'bg-canvas/60 font-semibold' : ''} ${total ? 'text-[15px] font-semibold' : ''}`}
    >
      <span>{label}</span>
      <span className={`tabular-nums ${value < 0 && total ? 'text-bad' : ''}`}>{rp(value)}</span>
    </div>
  )
}
