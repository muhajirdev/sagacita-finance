import { createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { TransactionTable, needsRelease } from '#/components/transactions'
import { ui } from '#/components/dialogs'
import { PageHeader } from '#/components/ui'
import { nextWeekday, rp } from '#/lib/format'
import { getPayables, releaseFn } from '#/server/fns'

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
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const isOwner = user.role === 'owner'
  const waiting = data.items.filter(needsRelease)
  const released = data.items.filter((t) => t.released_at)
  return (
    <>
      <PageHeader
        title="Payment run"
        sub="Approved spend due by this date. On the pay date the owner releases what gets paid; Finance then transfers and marks it paid."
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
        <span className="ml-auto text-[13px] text-muted">
          {data.items.length} items · {released.length} released ({rp(released.reduce((a, t) => a + t.outstanding, 0))}) · {waiting.length} waiting release
        </span>
        {isOwner && waiting.length > 0 && (
          <button
            className="btn py-1.5"
            onClick={async () => {
              if (!(await ui.confirm(`Release ${waiting.length} items?`, { message: `${rp(waiting.reduce((a, t) => a + t.outstanding, 0))} becomes payable by Finance.`, confirmLabel: 'Release' }))) return
              try {
                await releaseFn({ data: { ids: waiting.map((t) => t.id) } })
                await router.invalidate()
              } catch (e) {
                ui.error(e)
              }
            }}
          >
            Release all shown
          </button>
        )}
      </div>
      <TransactionTable rows={data.items} canRelease={isOwner} />
    </>
  )
}
