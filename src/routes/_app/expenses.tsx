import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'

import { Modal, PageHeader, Tabs } from '#/components/ui'
import type { TransactionRow } from '#/lib/finance'
import { KIND_LABEL, rp } from '#/lib/format'
import { getProject, getProjects, recordPaymentFn, recordTransactionFn, setStatusFn } from '#/server/fns'
import { getExpenses } from '#/server/pages'
import { Select, ui } from '#/components/dialogs'

const TABS = [
  ['all', 'All'],
  ['request', 'Advance Request'],
  ['unpaid', 'Approved, unpaid'],
  ['paid', 'Paid'],
  ['settled', 'Done Settlement'],
] as const
type Tab = (typeof TABS)[number][0]

export const Route = createFileRoute('/_app/expenses')({
  validateSearch: z.object({ tab: z.enum(['all', 'request', 'unpaid', 'paid', 'settled']).optional() }),
  loader: async () => ({ rows: await getExpenses(), projects: await getProjects() }),
  component: Expenses,
})

/** The original app's expense statuses, worked out from approval + payments. */
function stage(t: TransactionRow): Exclude<Tab, 'all'> | 'void' {
  if (t.status === 'void') return 'void'
  if (t.status === 'settled') return 'settled'
  if (t.status === 'draft') return 'request'
  return t.outstanding > 0 ? 'unpaid' : 'paid'
}
const STAGE_PILL = {
  request: <span className="pill-warn">Advance Request</span>,
  unpaid: <span className="pill-neutral">Approved</span>,
  paid: <span className="pill-good">Paid</span>,
  settled: <span className="pill-good">Done Settlement</span>,
  void: <span className="pill-neutral">Void</span>,
}

function Expenses() {
  const { rows, projects } = Route.useLoaderData()
  const { tab = 'all' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await router.invalidate()
    } catch (e) {
      ui.error(e)
    }
  }
  const list = rows.filter((t) => (tab === 'all' ? t.status !== 'void' : stage(t) === tab)).sort((a, b) => b.total - a.total)

  return (
    <>
      <PageHeader
        title="Expenses"
        sub="Vendor invoices, cash advances and reimbursements. New requests wait for approval before they can be paid."
        right={
          <button className="btn" onClick={() => setOpen(true)}>
            + Log expense
          </button>
        }
      />
      <div className="mb-4">
        <Tabs<Tab> value={tab} options={TABS} onChange={(t) => navigate({ search: { tab: t } })} />
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Project</th>
              <th className="th">SOW Item</th>
              <th className="th">Vendor / Category</th>
              <th className="th">Purpose</th>
              <th className="th num">Amount</th>
              <th className="th">Requested By</th>
              <th className="th">Status</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const s = stage(t)
              return (
                <tr
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() => t.project_code && navigate({ to: '/projects/$code', params: { code: t.project_code } })}
                >
                  <td className="td whitespace-nowrap">
                    {t.project_code ?? 'Company'}
                    <div className="text-[12px] text-muted">{t.client ?? t.category}</div>
                  </td>
                  <td className="td">{t.budget_line ?? '—'}</td>
                  <td className="td">
                    {t.party ?? '—'}
                    <div className="text-[12px] text-muted">{KIND_LABEL[t.kind]}</div>
                  </td>
                  <td className="td max-w-64">
                    {t.description}
                    <div className="mt-0.5 flex gap-2 text-[12px]" onClick={(e) => e.stopPropagation()}>
                      {t.attachment_url && (
                        <a
                          className="text-accent"
                          href={t.attachment_url.replace(/^https?:\/\/[^/]+/, '')}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View document
                        </a>
                      )}
                      <label className="cursor-pointer text-muted hover:text-ink">
                        Attach
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*,application/pdf"
                          onChange={async (e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            const body = new FormData()
                            body.set('file', file)
                            const res = await fetch(`/files/${t.id}?entity=transaction`, { method: 'POST', body })
                            if (!res.ok) ui.toast(await res.text(), 'bad')
                            else ui.toast('Document attached')
                            await router.invalidate()
                          }}
                        />
                      </label>
                    </div>
                  </td>
                  <td className="td num">
                    {rp(t.total)}
                    {t.paid > 0 && t.outstanding > 0 && <div className="text-[12px] text-muted">paid {rp(t.paid)}</div>}
                  </td>
                  <td className="td">{t.requested_by ?? '—'}</td>
                  <td className="td">{STAGE_PILL[s]}</td>
                  <td className="td whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                    {s === 'request' && (
                      <button className="btn-ghost mr-1" onClick={() => act(() => setStatusFn({ data: { id: t.id, status: 'approved' } }))}>
                        Approve
                      </button>
                    )}
                    {s === 'unpaid' && (
                      <button
                        className="btn-ghost mr-1"
                        onClick={async () => {
                          const v = await ui.prompt(
                            `Pay ${t.party ?? 'expense'}`,
                            [
                              {
                                name: 'amount',
                                label: 'Amount paid (IDR)',
                                type: 'number',
                                min: 1,
                                defaultValue: String(t.outstanding),
                                hint: `Outstanding ${rp(t.outstanding)}`,
                              },
                              { name: 'date', label: 'Payment date', type: 'date', defaultValue: new Date().toISOString().slice(0, 10) },
                            ],
                            { submitLabel: 'Record payment' },
                          )
                          if (v) act(() => recordPaymentFn({ data: { transactionId: t.id, amount: Number(v.amount), date: v.date } }))
                        }}
                      >
                        Pay
                      </button>
                    )}
                    {s === 'paid' && t.kind === 'cash_advance' && (
                      <button className="btn-ghost mr-1" onClick={() => act(() => setStatusFn({ data: { id: t.id, status: 'settled' } }))}>
                        Settle
                      </button>
                    )}
                    {t.paid === 0 && s !== 'void' && (
                      <button
                        className="btn-ghost"
                        onClick={async () =>
                          (await ui.confirm('Void this expense?', {
                            message: 'It stops counting against the budget. This cannot be undone.',
                            confirmLabel: 'Void',
                            danger: true,
                          })) && act(() => setStatusFn({ data: { id: t.id, status: 'void' } }))
                        }
                      >
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {list.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={8}>
                  No expenses in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {open && (
        <ExpenseForm
          projects={projects}
          onClose={() => setOpen(false)}
          onSaved={async () => {
            setOpen(false)
            await router.invalidate()
          }}
        />
      )}
    </>
  )
}

const CATEGORIES = [
  ['vendor_bill', 'Vendor invoice'],
  ['cash_advance', 'Cash advance'],
  ['reimbursement', 'Reimbursement'],
] as const

function ExpenseForm({
  projects,
  onClose,
  onSaved,
}: {
  projects: { id: number; code: string; client: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [projectCode, setProjectCode] = useState(projects[0]?.code ?? '')
  const [lines, setLines] = useState<{ id: number; name: string; ceiling: number; actual: number }[]>([])
  const [kind, setKind] = useState<(typeof CATEGORIES)[number][0]>('vendor_bill')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (projectCode) getProject({ data: { code: projectCode } }).then((d) => setLines(d.budget.lines))
  }, [projectCode])
  const projectId = projects.find((p) => p.code === projectCode)?.id
  return (
    <Modal title="Log expense" onClose={onClose}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const s = (k: string) => (f.get(k) ? String(f.get(k)) : undefined)
          try {
            const r = await recordTransactionFn({
              data: {
                kind,
                projectId,
                budgetLineId: Number(s('budgetLineId')),
                partyName: s('partyName'),
                description: s('description'),
                number: s('number'),
                dueDate: s('dueDate'),
                dpp: Number(s('dpp') ?? 0),
                withPpn: kind === 'vendor_bill' && f.get('withPpn') === 'on',
                pphType: (s('pphType') ?? 'none') as 'none',
                requestedBy: s('requestedBy'),
              },
            })
            if (r.warning) ui.toast(r.warning, 'warn')
            onSaved()
          } catch (err) {
            setMsg(err instanceof Error ? err.message : String(err))
          }
        }}
      >
        <label className="field">
          Project
          <Select
            value={projectCode}
            onChange={setProjectCode}
            options={projects.map((p) => ({ value: p.code, label: `${p.code} — ${p.client}` }))}
          />
        </label>
        <label className="field">
          SOW item
          <Select
            key={lines.map((l) => l.id).join()}
            name="budgetLineId"
            required
            placeholder="No SOW items"
            options={lines.map((l) => ({ value: String(l.id), label: `${l.name} (${rp(l.ceiling - l.actual)} left)` }))}
          />
        </label>
        <label className="field">
          Payment category
          <Select value={kind} onChange={(v) => setKind(v as typeof kind)} options={CATEGORIES.map(([v, l]) => ({ value: v, label: l }))} />
        </label>
        <label className="field">
          {kind === 'vendor_bill' ? 'Vendor name' : 'Employee name'}
          <input className="input" name="partyName" required />
        </label>
        <label className="field sm:col-span-2">
          Purpose / description
          <input className="input" name="description" />
        </label>
        <label className="field">
          Amount before tax (IDR)
          <input className="input" name="dpp" type="number" min="0" required />
        </label>
        <label className="field">
          Requested by
          <input className="input" name="requestedBy" />
        </label>
        {kind === 'vendor_bill' && (
          <>
            <label className="field">
              Vendor invoice no.
              <input className="input" name="number" />
            </label>
            <label className="field">
              PPh withheld
              <Select
                name="pphType"
                defaultValue="pph23"
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'pph23', label: 'PPh 23 (2%)' },
                  { value: 'pph4_2', label: 'PPh 4(2) (10%)' },
                  { value: 'pph26', label: 'PPh 26 (20%)' },
                ]}
              />
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" name="withPpn" defaultChecked /> Vendor charges VAT 11%
            </label>
          </>
        )}
        <label className="field">
          Due date
          <input className="input" name="dueDate" type="date" />
        </label>
        {msg && <p className="text-[13px] text-bad sm:col-span-2">{msg}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn-ghost py-2" onClick={onClose}>
            Cancel
          </button>
          <button className="btn">Log expense</button>
        </div>
      </form>
    </Modal>
  )
}
