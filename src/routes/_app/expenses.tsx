import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'

import { Modal, PageHeader, Tabs } from '#/components/ui'
import type { TransactionRow } from '#/lib/finance'
import { KIND_LABEL, rp } from '#/lib/format'
import {
  getProject,
  getProjects,
  getReference,
  recordPaymentFn,
  recordTransactionFn,
  setAccountFn,
  setStatusFn,
  settleAdvanceFn,
} from '#/server/fns'
import { getExpenses } from '#/server/pages'
import { getLpjSubmissions, lpjLinkFn, settleFromLpjFn } from '#/server/lpj'
import type { LpjItem } from '#/lib/lpj'
import { Select, ui } from '#/components/dialogs'
import { FilterBar } from '#/components/filter-bar'
import { VendorPicker } from '#/components/vendor-picker'
import { filterSearch, pickFilters } from '#/lib/filters'

const TABS = [
  ['all', 'All'],
  ['request', 'Waiting approval'],
  ['unpaid', 'Approved, unpaid'],
  ['paid', 'Paid'],
  ['settled', 'Done Settlement'],
] as const
type Tab = (typeof TABS)[number][0]

export const Route = createFileRoute('/_app/expenses')({
  validateSearch: filterSearch.extend({
    tab: z.enum(['all', 'request', 'unpaid', 'paid', 'settled']).optional(),
  }),
  loaderDeps: ({ search }) => pickFilters(search),
  loader: async ({ deps }) => {
    const [rows, projects, ref] = await Promise.all([getExpenses({ data: deps }), getProjects(), getReference()])
    // LPJs employees submitted through their link, for paid advances not settled yet.
    const advanceIds = rows.filter((t) => t.kind === 'cash_advance' && t.status === 'approved').map((t) => t.id)
    const lpj = await getLpjSubmissions({ data: { advanceIds } })
    return {
      rows,
      projects,
      vendors: ref.vendors,
      accounts: ref.accounts,
      ref,
      lpj,
    }
  },
  component: Expenses,
})

/** The original app's expense statuses, worked out from approval + payments. */
function stage(t: TransactionRow): Exclude<Tab, 'all'> | 'void' {
  if (t.status === 'void') return 'void'
  if (t.status === 'settled') return 'settled'
  if (t.status === 'draft') return 'request'
  return t.outstanding !== 0 ? 'unpaid' : 'paid'
}
const STAGE_PILL = {
  request: <span className="pill-warn">Waiting approval</span>,
  unpaid: <span className="pill-neutral">Approved</span>,
  paid: <span className="pill-good">Paid</span>,
  settled: <span className="pill-good">Done Settlement</span>,
  void: <span className="pill-neutral">Void</span>,
}

function Expenses() {
  const { rows, projects, vendors, accounts, ref, lpj } = Route.useLoaderData()
  const [review, setReview] = useState<TransactionRow | null>(null)
  const [settling, setSettling] = useState<TransactionRow | null>(null)
  const search = Route.useSearch()
  const { tab = 'all' } = search
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
  const costAccounts = accounts.filter((a) => a.group === 'cost_of_service' || a.group === 'operating_expense')
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
      <FilterBar value={pickFilters(search)} lists={ref} onChange={(f) => navigate({ search: (prev) => ({ ...prev, ...f }) })} />
      <div className="mb-4">
        <Tabs<Tab> value={tab} options={TABS} onChange={(t) => navigate({ search: (prev) => ({ ...prev, tab: t }) })} />
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Project</th>
              <th className="th">SOW Item</th>
              <th className="th">Vendor / Category</th>
              <th className="th">COA</th>
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
                  onClick={() =>
                    t.project_code &&
                    navigate({
                      to: '/projects/$code',
                      params: { code: t.project_code },
                    })
                  }
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
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    {t.kind === 'cash_advance' && <span className="text-[12px] text-muted">COA on the LPJ</span>}
                    {t.kind !== 'tax_payment' && t.kind !== 'cash_advance' && (
                      <select
                        className={`input w-44 py-1 text-[12px] ${t.account_id ? '' : 'text-muted'}`}
                        value={t.account_id ?? ''}
                        title={t.account ?? 'Pick the chart of accounts line'}
                        onChange={(e) =>
                          act(() =>
                            setAccountFn({
                              data: {
                                ids: [t.id],
                                accountId: e.target.value ? Number(e.target.value) : null,
                              },
                            }),
                          )
                        }
                      >
                        <option value="">Pick COA…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {a.name}
                          </option>
                        ))}
                      </select>
                    )}
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
                    <PaymentList list={t.payment_list} />
                  </td>
                  <td className="td">{t.requested_by ?? '—'}</td>
                  <td className="td">
                    {lpj[t.id]?.submittedAt && t.status === 'approved' ? (
                      <span className="pill-warn">LPJ submitted, waiting review</span>
                    ) : (
                      STAGE_PILL[s]
                    )}
                    {t.lpj_due && (
                      <div
                        className={`mt-0.5 text-[12px] ${t.lpj_due < new Date().toISOString().slice(0, 10) ? 'text-bad' : 'text-muted'}`}
                      >
                        LPJ due {t.lpj_due}
                      </div>
                    )}
                  </td>
                  <td className="td whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                    {s === 'request' && (
                      <Link to="/approvals" className="btn-ghost mr-1">
                        In Approvals
                      </Link>
                    )}
                    {s === 'unpaid' && (
                      <button
                        className="btn-ghost mr-1"
                        onClick={async () => {
                          const v = await ui.prompt(
                            t.outstanding < 0 ? `Refund from ${t.party ?? 'advance holder'}` : `Pay ${t.party ?? 'expense'}`,
                            [
                              {
                                name: 'amount',
                                label: t.outstanding < 0 ? 'Refund received (IDR)' : 'Amount paid (IDR)',
                                type: 'number',
                                min: 1,
                                defaultValue: String(Math.abs(t.outstanding)),
                                hint: `Outstanding ${rp(t.outstanding)}`,
                              },
                              {
                                name: 'date',
                                label: 'Payment date',
                                type: 'date',
                                defaultValue: new Date().toISOString().slice(0, 10),
                              },
                            ],
                            { submitLabel: 'Record payment' },
                          )
                          if (v)
                            act(() =>
                              recordPaymentFn({
                                data: {
                                  transactionId: t.id,
                                  amount: Number(v.amount),
                                  date: v.date,
                                },
                              }),
                            )
                        }}
                      >
                        Pay
                      </button>
                    )}
                    {s === 'paid' && t.kind === 'cash_advance' && lpj[t.id]?.submittedAt && (
                      <button className="btn mr-1 px-3 py-1 text-[12px]" onClick={() => setReview(t)}>
                        Review LPJ
                      </button>
                    )}
                    {s === 'paid' && t.kind === 'cash_advance' && (
                      <button
                        className="btn-ghost mr-1"
                        title="A secret link the advance holder opens on their phone to fill the LPJ with receipts. No login."
                        onClick={() =>
                          act(async () => {
                            const link = await lpjLinkFn({
                              data: { advanceId: t.id },
                            })
                            try {
                              await navigator.clipboard.writeText(link.url)
                              ui.toast('LPJ link copied. Send it to ' + (link.person ?? 'the advance holder'))
                            } catch {
                              await ui.prompt(
                                'LPJ link',
                                [
                                  {
                                    name: 'url',
                                    label: 'Copy this link',
                                    defaultValue: link.url,
                                  },
                                ],
                                { submitLabel: 'Done' },
                              )
                            }
                          })
                        }
                      >
                        Copy LPJ link
                      </button>
                    )}
                    {s === 'paid' && t.kind === 'cash_advance' && !lpj[t.id]?.submittedAt && (
                      <button className="btn-ghost mr-1" onClick={() => setSettling(t)}>
                        Submit LPJ
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
                <td className="td text-muted" colSpan={9}>
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
          accounts={accounts}
          vendors={vendors}
          onClose={() => setOpen(false)}
          onSaved={async () => {
            setOpen(false)
            await router.invalidate()
          }}
        />
      )}
      {settling && (
        <SettleForm
          advance={settling}
          accounts={costAccounts}
          onClose={() => setSettling(null)}
          onSettle={(lines, date) =>
            act(async () => {
              await settleAdvanceFn({
                data: { advanceId: settling.id, lines, date },
              })
              setSettling(null)
              ui.toast('LPJ settled')
            })
          }
        />
      )}
      {review && lpj[review.id] && (
        <LpjReview
          advance={review}
          sub={lpj[review.id]}
          onClose={() => setReview(null)}
          accounts={costAccounts}
          onSettle={(date, accountIds) =>
            act(async () => {
              await settleFromLpjFn({
                data: { advanceId: review.id, date, accountIds },
              })
              setReview(null)
              ui.toast('LPJ settled')
            })
          }
        />
      )}
    </>
  )
}

/** Finance reviews what the employee submitted through the LPJ link, then settles it (one LPJ line per item). */
function LpjReview({
  advance,
  sub,
  accounts,
  onClose,
  onSettle,
}: {
  advance: TransactionRow
  sub: {
    submittedAt: string | null
    items: LpjItem[]
    spent: number
    note: string | null
  }
  accounts: Account[]
  onClose: () => void
  onSettle: (date: string, accountIds: (number | null)[]) => void
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [coa, setCoa] = useState<(number | null)[]>(() => sub.items.map(() => null))
  const diff = sub.spent - advance.total
  return (
    <Modal title={`LPJ ${advance.number ?? ''} · ${advance.requested_by ?? advance.party ?? ''}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <p className="text-muted">Submitted {sub.submittedAt?.slice(0, 16).replace('T', ' ')} UTC through the LPJ link.</p>
        <table className="table">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Item</th>
              <th className="th">COA</th>
              <th className="th">Receipt</th>
              <th className="th num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {sub.items.map((i, n) => (
              <tr key={n}>
                <td className="td whitespace-nowrap">{i.date}</td>
                <td className="td">{i.description}</td>
                <td className="td">
                  <CoaSelect accounts={accounts} value={coa[n]} onChange={(v) => setCoa((c) => c.map((x, k) => (k === n ? v : x)))} />
                </td>
                <td className="td">
                  {i.documentId ? (
                    <a className="text-accent" href={`/files/${i.documentId}`} target="_blank" rel="noreferrer">
                      View
                    </a>
                  ) : (
                    <span className="text-bad">None</span>
                  )}
                </td>
                <td className="td num">{rp(i.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sub.note && <p>Note: {sub.note}</p>}
        <dl className="space-y-1">
          <div className="flex justify-between">
            <dt className="text-muted">Advanced</dt>
            <dd className="num">{rp(advance.total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Spent</dt>
            <dd className="num">{rp(sub.spent)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>{diff > 0 ? 'Still to pay them (becomes a bill)' : diff < 0 ? 'They refund (becomes a refund)' : 'Difference'}</dt>
            <dd className="num">{rp(Math.abs(diff))}</dd>
          </div>
        </dl>
        <p className="text-muted">Something wrong? Send them the same link again; they can change it until you settle.</p>
        <div className="flex items-end justify-end gap-2">
          <label className="text-[12px] text-muted">
            LPJ date
            <input className="input mt-1" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button className="btn" onClick={() => (coa.some((c) => !c) ? ui.toast('Pick the COA for every item', 'warn') : onSettle(date, coa))}>
            Approve and settle
          </button>
        </div>
      </div>
    </Modal>
  )
}

type Account = { id: number; code: string; name: string; group: string }

function CoaSelect({ accounts, value, onChange }: { accounts: Account[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <select className="input py-1.5" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Pick COA</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} {a.name}
        </option>
      ))}
    </select>
  )
}

/** Finance settles a paid cash advance line by line: each line has its own description, COA and amount. */
function SettleForm({
  advance,
  accounts,
  onClose,
  onSettle,
}: {
  advance: TransactionRow
  accounts: Account[]
  onClose: () => void
  onSettle: (lines: { description?: string; accountId: number | null; amount: number }[], date: string) => void
}) {
  type Line = { description: string; accountId: number | null; amount: string }
  const blank = (): Line => ({ description: '', accountId: null, amount: '' })
  const [lines, setLines] = useState<Line[]>([blank()])
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const set = (n: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === n ? { ...l, ...p } : l)))
  const spent = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0)
  const diff = spent - advance.total
  return (
    <Modal title={`Settlement / LPJ ${advance.number ?? ''} · ${advance.requested_by ?? advance.party ?? ''}`} onClose={onClose} wide>
      <form
        className="space-y-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          const out = lines
            .filter((l) => Number(l.amount) > 0)
            .map((l) => ({
              description: l.description.trim() || undefined,
              accountId: l.accountId,
              amount: Math.round(Number(l.amount)),
            }))
          if (!out.length) return ui.toast('Add at least one line with an amount', 'warn')
          if (out.some((l) => !l.accountId)) return ui.toast('Pick the COA for every line', 'warn')
          onSettle(out, date)
        }}
      >
        <table className="table">
          <thead>
            <tr>
              <th className="th">Description</th>
              <th className="th">COA</th>
              <th className="th num">Amount (IDR)</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, n) => (
              <tr key={n}>
                <td className="td">
                  <input
                    className="input py-1.5"
                    value={l.description}
                    placeholder="e.g. Konsumsi meeting klien"
                    onChange={(e) => set(n, { description: e.target.value })}
                  />
                </td>
                <td className="td">
                  <CoaSelect accounts={accounts} value={l.accountId} onChange={(v) => set(n, { accountId: v })} />
                </td>
                <td className="td">
                  <input
                    className="input py-1.5 text-right"
                    type="number"
                    min="0"
                    value={l.amount}
                    onChange={(e) => set(n, { amount: e.target.value })}
                  />
                </td>
                <td className="td">
                  {lines.length > 1 && (
                    <button type="button" className="btn-ghost" onClick={() => setLines((ls) => ls.filter((_, k) => k !== n))}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn-ghost" onClick={() => setLines((ls) => [...ls, blank()])}>
          + Add line
        </button>
        <dl className="space-y-1">
          <div className="flex justify-between">
            <dt className="text-muted">Advanced</dt>
            <dd className="num">{rp(advance.total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Actually spent</dt>
            <dd className="num">{rp(spent)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>{diff > 0 ? 'Still to pay them' : diff < 0 ? 'They refund' : 'Difference'}</dt>
            <dd className="num">{rp(Math.abs(diff))}</dd>
          </div>
        </dl>
        <p className="text-muted">Attach the receipts on the advance with "Attach".</p>
        <div className="flex items-end justify-end gap-2">
          <label className="text-[12px] text-muted">
            LPJ date
            <input className="input mt-1" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="button" className="btn-ghost py-2" onClick={onClose}>
            Cancel
          </button>
          <button className="btn">Settle</button>
        </div>
      </form>
    </Modal>
  )
}

const CATEGORIES = [
  ['vendor_bill', 'Vendor invoice'],
  ['cash_advance', 'Cash advance'],
  ['reimbursement', 'Reimbursement'],
] as const

function ExpenseForm({
  projects,
  accounts,
  vendors,
  onClose,
  onSaved,
}: {
  projects: { id: number; code: string; client: string }[]
  accounts: { id: number; code: string; name: string; group: string }[]
  vendors: {
    id: number
    name: string
    bankName?: string | null
    bankAccount?: string | null
  }[]
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
                accountId: kind !== 'cash_advance' && s('accountId') ? Number(s('accountId')) : null,
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
            options={projects.map((p) => ({
              value: p.code,
              label: `${p.code} — ${p.client}`,
            }))}
          />
        </label>
        <label className="field">
          SOW item
          <Select
            key={lines.map((l) => l.id).join()}
            name="budgetLineId"
            required
            placeholder="No SOW items"
            options={lines.map((l) => ({
              value: String(l.id),
              label: `${l.name} (${rp(l.ceiling - l.actual)} left)`,
            }))}
          />
        </label>
        <label className="field">
          Payment category
          <Select value={kind} onChange={(v) => setKind(v as typeof kind)} options={CATEGORIES.map(([v, l]) => ({ value: v, label: l }))} />
        </label>
        <label className="field">
          {kind === 'vendor_bill' ? 'Vendor' : 'Employee name'}
          {kind === 'vendor_bill' ? (
            <VendorPicker vendors={vendors} name="partyName" />
          ) : (
            <input className="input" name="partyName" required />
          )}
        </label>
        {kind !== 'cash_advance' && (
          <label className="field sm:col-span-2">
            COA (chart of accounts)
            <Select
              name="accountId"
              placeholder="Pick the COA line"
              options={accounts
                .filter((a) => a.group === 'cost_of_service' || a.group === 'operating_expense')
                .map((a) => ({
                  value: String(a.id),
                  label: `${a.code} ${a.name}`,
                }))}
            />
          </label>
        )}
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

/** Shows each instalment when a row was paid more than once. */
function PaymentList({ list }: { list: string | null }) {
  const items = (list ?? '').split('; ').filter(Boolean)
  if (items.length < 2) return null
  return (
    <div className="mt-1 text-[12px] text-muted">
      {items.map((x) => {
        const [d, a] = x.split(' ')
        return (
          <div key={x}>
            {d} · {rp(Number(a))}
          </div>
        )
      })}
    </div>
  )
}
