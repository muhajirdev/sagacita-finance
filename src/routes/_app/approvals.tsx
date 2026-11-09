import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { PageHeader, StatusPill } from '#/components/ui'
import { rp } from '#/lib/format'
import { acknowledgeSpendFn, decideApprovalFn, getApprovals } from '#/server/fns'
import { ui } from '#/components/dialogs'

const search = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() })

export const Route = createFileRoute('/_app/approvals')({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getApprovals({ data: { status: deps.status } }),
  component: Approvals,
})

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

function Approvals() {
  const { approvals, canDecide, canAcknowledge } = Route.useLoaderData()
  const { status = 'pending' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const decide = async (id: number, decision: 'approve' | 'reject') => {
    let note: string | undefined
    if (decision === 'reject') {
      const v = await ui.prompt('Reject request', [{ name: 'note', label: 'Reason' }], { submitLabel: 'Reject' })
      if (!v) return
      note = v.note
    }
    try {
      await decideApprovalFn({ data: { id, decision, note: note ?? undefined } })
      await router.invalidate()
    } catch (e) {
      ui.error(e)
    }
  }
  const acknowledge = async (id: number) => {
    const v = await ui.prompt(
      'Acknowledge and schedule payment',
      [{ name: 'payDate', label: 'Proposed pay date', type: 'date', defaultValue: new Date().toISOString().slice(0, 10) }],
      { submitLabel: 'Acknowledge' },
    )
    if (!v?.payDate) return
    try {
      await acknowledgeSpendFn({ data: { id, payDate: v.payDate } })
      await router.invalidate()
    } catch (e) {
      ui.error(e)
    }
  }
  return (
    <>
      <PageHeader
        title="Approvals"
        sub="Budgets are approved by the owner. Spend goes: team submits, finance PIC acknowledges and sets a pay date, BOD releases."
        right={
          <div className="inline-flex rounded-full bg-black/[0.05] p-0.5">
            {(['pending', 'approved', 'rejected'] as const).map((s) => (
              <button
                key={s}
                className={`rounded-full px-3.5 py-1 text-[13px] font-medium capitalize transition ${status === s ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
                onClick={() => navigate({ search: { status: s } })}
              >
                {s}
              </button>
            ))}
          </div>
        }
      />
      <div className="card divide-y divide-line">
        {approvals.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="pill-neutral">{a.entity === 'project' ? 'Budget' : 'Spend'}</span>
                <span className="text-[12px] text-muted">
                  #{a.id} · {a.requestedBy} · {when(a.requestedAt)}
                </span>
              </div>
              <div className="mt-1 text-[14px] font-medium">{a.summary}</div>
              {a.entity === 'transaction' && a.status === 'pending' && (
                <div className="mt-1 text-[12px] text-muted">
                  {a.acknowledgedAt
                    ? `Finance acknowledged (${a.acknowledgedBy}), pay on ${a.payDate}. Waiting for BOD release.`
                    : 'Waiting for finance PIC to acknowledge and set a pay date.'}
                </div>
              )}
              {a.note && <div className="mt-0.5 text-[12px] text-muted">Note: {a.note}</div>}
              {a.decidedBy && (
                <div className="mt-0.5 text-[12px] text-muted">
                  {a.status} by {a.decidedBy} · {when(a.decidedAt)}
                </div>
              )}
            </div>
            <div className="text-[14px] font-semibold tabular-nums">{rp(a.amount)}</div>
            {a.status === 'pending' && (canDecide || canAcknowledge) ? (
              <div className="flex gap-2">
                {canDecide && (
                  <button className="btn-ghost py-1.5" onClick={() => decide(a.id, 'reject')}>
                    Reject
                  </button>
                )}
                {a.entity === 'transaction' && !a.acknowledgedAt && canAcknowledge && (
                  <button className="btn" onClick={() => acknowledge(a.id)}>
                    Acknowledge
                  </button>
                )}
                {canDecide && (a.entity === 'project' || a.acknowledgedAt) && (
                  <button className="btn" onClick={() => decide(a.id, 'approve')}>
                    {a.entity === 'project' ? 'Approve' : 'Release'}
                  </button>
                )}
              </div>
            ) : (
              <StatusPill status={a.status === 'approved' ? 'approved' : a.status === 'rejected' ? 'void' : 'draft'} />
            )}
          </div>
        ))}
        {approvals.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-muted">Nothing {status}.</div>}
      </div>
      {!canDecide && <p className="mt-3 text-[12px] text-muted">Only BOD (owner) can approve budgets and release spend.</p>}
      <p className="mt-3 text-[12px] text-muted">
        Releasing spend makes it payable on the{' '}
        <Link to="/payables" className="text-accent">
          payment run
        </Link>
        . Rejecting voids it.
      </p>
    </>
  )
}
