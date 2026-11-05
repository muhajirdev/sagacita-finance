import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { TransactionTable } from '#/components/transactions'
import { nextWeekday, rp } from '#/lib/format'
import { getPayables } from '#/server/fns'

export const Route = createFileRoute('/_app/payables')({
  validateSearch: z.object({ dueBy: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getPayables({ data: { dueBy: deps.dueBy ?? nextWeekday(3) } }),
  component: Payables,
})

function Payables() {
  const data = Route.useLoaderData()
  const { dueBy = nextWeekday(3) } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-stone-500">
          Payment run date
          <input
            className="input mt-1"
            type="date"
            value={dueBy}
            onChange={(e) => navigate({ search: { dueBy: e.target.value } })}
          />
        </label>
        <button className="btn-ghost" onClick={() => navigate({ search: { dueBy: nextWeekday(3) } })}>
          Next Wednesday
        </button>
        <button className="btn-ghost" onClick={() => navigate({ search: { dueBy: nextWeekday(5) } })}>
          Next Friday
        </button>
        <div className="ml-auto text-right">
          <div className="text-xs text-stone-500">Cash needed</div>
          <div className="text-2xl font-semibold tabular-nums">{rp(data.totalOutstanding)}</div>
        </div>
      </div>
      <p className="text-sm text-stone-500">Approved bills, advances and reimbursements not fully paid, due by this date or with no due date.</p>
      <TransactionTable rows={data.items} />
    </div>
  )
}
