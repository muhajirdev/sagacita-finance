import { Link, createFileRoute } from '@tanstack/react-router'

import { rp, rpShort } from '#/lib/format'
import { getDashboard } from '#/server/fns'

export const Route = createFileRoute('/_app/')({
  loader: () => getDashboard(),
  component: Dashboard,
})

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-stone-500">{sub}</div>
    </div>
  )
}

function Dashboard() {
  const d = Route.useLoaderData()
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Projects" value={String(d.projects.length)} sub="all divisions" />
        <Stat label="Billed (net)" value={rpShort(d.billing)} sub="client invoices, before VAT" />
        <Stat label="Collected" value={rpShort(d.collected)} sub="payments received" />
        <Stat label="Payables due today" value={rpShort(d.payablesToday)} sub="approved, unpaid" />
      </div>
      {(d.overdueInvoices > 0 || d.overBudget > 0) && (
        <div className="card border-amber-300 bg-amber-50 p-4 text-sm">
          {d.overdueInvoices > 0 && <div>{d.overdueInvoices} overdue client invoice(s)</div>}
          {d.overBudget > 0 && <div>{d.overBudget} project(s) over their expense ceiling</div>}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Project</th>
              <th className="th">Client</th>
              <th className="th">Division</th>
              <th className="th num">Charge</th>
              <th className="th num">Spent</th>
              <th className="th num">Used</th>
              <th className="th num">Margin</th>
            </tr>
          </thead>
          <tbody>
            {d.projects.map((p) => (
              <tr key={p.id}>
                <td className="td">
                  <Link to="/projects/$code" params={{ code: p.code }} className="font-medium text-brand">
                    {p.code}
                  </Link>
                  <div className="text-xs text-stone-500">{p.name}</div>
                </td>
                <td className="td">{p.client}</td>
                <td className="td">{p.division}</td>
                <td className="td num">{rp(p.totals.charge)}</td>
                <td className="td num">{rp(p.totals.actual)}</td>
                <td className={`td num ${p.totals.usedPct > 100 ? 'font-semibold text-red-700' : ''}`}>{p.totals.usedPct}%</td>
                <td className="td num">{rp(p.totals.actualMargin)}</td>
              </tr>
            ))}
            {d.projects.length === 0 && (
              <tr>
                <td className="td text-stone-500" colSpan={7}>
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
