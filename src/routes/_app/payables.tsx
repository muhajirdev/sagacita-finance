import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { TransactionTable } from '#/components/transactions'
import { PageHeader } from '#/components/ui'
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
    <>
      <PageHeader
        title="Payment run"
        sub="Approved bills, advances and reimbursements not fully paid, due by this date or with no due date."
        right={
          <div className="card px-5 py-3 text-right">
            <div className="eyebrow">Cash needed</div>
            <div className="text-[24px] font-semibold tracking-[-0.02em] tabular-nums">{rp(data.totalOutstanding)}</div>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input w-auto" type="date" value={dueBy} onChange={(e) => navigate({ search: { dueBy: e.target.value } })} />
        <button className="btn-ghost py-1.5" onClick={() => navigate({ search: { dueBy: nextWeekday(3) } })}>
          Next Wednesday
        </button>
        <button className="btn-ghost py-1.5" onClick={() => navigate({ search: { dueBy: nextWeekday(5) } })}>
          Next Friday
        </button>
        <span className="ml-auto text-[13px] text-muted">{data.items.length} items</span>
      </div>
      <TransactionTable rows={data.items} />
    </>
  )
}
