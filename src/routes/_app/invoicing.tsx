import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'

import { Modal, PageHeader, Tabs, TypeBadge, fdate } from '#/components/ui'
import type { TransactionRow } from '#/lib/finance'
import { rp } from '#/lib/format'
import { recordPaymentFn, recordTransactionFn } from '#/server/fns'
import { getInvoicing, updateTransactionFn } from '#/server/pages'
import { Select, ui } from '#/components/dialogs'

const TABS = [
  ['pending', 'Pending'],
  ['paid', 'Paid'],
  ['uninvoiced', 'Uninvoiced Balance'],
] as const
type Tab = (typeof TABS)[number][0]

export const Route = createFileRoute('/_app/invoicing')({
  validateSearch: z.object({ tab: z.enum(['pending', 'paid', 'uninvoiced']).optional() }),
  loader: () => getInvoicing(),
  component: Invoicing,
})

const termsOf = (t: TransactionRow) => {
  if (!t.due_date) return '—'
  const days = Math.round((new Date(t.due_date).getTime() - new Date(t.issue_date).getTime()) / 86400000)
  return days === 14 || days === 30 ? `NET ${days}` : `${days} days`
}

function InvoiceStatus({ t }: { t: TransactionRow }) {
  if (t.status === 'void') return <span className="pill-neutral">Void</span>
  if (t.outstanding <= 0) return <span className="pill-good">Paid</span>
  if (t.overdue) return <span className="pill-bad">Overdue</span>
  if (t.paid > 0) return <span className="pill-warn">Part paid</span>
  return <span className="pill-neutral">Sent to client</span>
}

function Invoicing() {
  const { invoices, projects } = Route.useLoaderData()
  const { tab = 'pending' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [form, setForm] = useState<TransactionRow | 'new' | null>(null)

  const list = invoices
    .filter((i) => i.status !== 'void' && (tab === 'paid' ? i.outstanding <= 0 : i.outstanding > 0))
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date))

  return (
    <>
      <PageHeader
        title="Invoicing"
        sub="Client invoices. Net is before VAT and is what every report uses."
        right={
          <button className="btn" onClick={() => setForm('new')}>
            + New invoice
          </button>
        }
      />
      <div className="mb-4">
        <Tabs<Tab> value={tab} options={TABS} onChange={(t) => navigate({ search: { tab: t } })} />
      </div>

      {tab === 'uninvoiced' ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="th">Client / Project</th>
                <th className="th num">Total Quotation</th>
                <th className="th num">Invoiced So Far</th>
                <th className="th num">Remaining</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const remain = p.totals.charge - p.totals.billed
                const status =
                  remain <= 1 && p.totals.charge > 0 ? (
                    <span className="pill-good">Fully invoiced</span>
                  ) : p.totals.billed > 0 ? (
                    <span className="pill-neutral">Partially invoiced</span>
                  ) : (
                    <span className="pill-warn">Not yet invoiced</span>
                  )
                return (
                  <tr key={p.id} className="cursor-pointer" onClick={() => navigate({ to: '/budget', search: { project: p.code } })}>
                    <td className="td">
                      <div className="font-medium">{p.client}</div>
                      <div className="text-[12px] text-muted">
                        {p.name} · <TypeBadge type={p.type} />
                      </div>
                    </td>
                    <td className="td num">{rp(p.totals.charge)}</td>
                    <td className="td num">{rp(p.totals.billed)}</td>
                    <td className="td num">{rp(remain)}</td>
                    <td className="td">{status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="th">Invoice No.</th>
                <th className="th">Client / Project</th>
                <th className="th num">Net (pre-VAT)</th>
                <th className="th num">{tab === 'paid' ? 'Received' : 'Outstanding'}</th>
                <th className="th">Date</th>
                <th className="th">Due</th>
                <th className="th">Terms</th>
                <th className="th">Status</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr
                  key={i.id}
                  className="cursor-pointer"
                  onClick={() =>
                    i.paid === 0 ? setForm(i) : i.project_code && navigate({ to: '/projects/$code', params: { code: i.project_code } })
                  }
                >
                  <td className="td whitespace-nowrap font-medium tabular-nums">{i.number ?? '—'}</td>
                  <td className="td">
                    {i.client}
                    <div className="text-[12px] text-muted">{i.project_name}</div>
                  </td>
                  <td className="td num">{rp(i.dpp)}</td>
                  <td className="td num">{rp(tab === 'paid' ? i.paid : i.outstanding)}</td>
                  <td className="td whitespace-nowrap">{fdate(i.issue_date)}</td>
                  <td className="td whitespace-nowrap">{fdate(i.due_date)}</td>
                  <td className="td whitespace-nowrap">{termsOf(i)}</td>
                  <td className="td">
                    <InvoiceStatus t={i} />
                  </td>
                  <td className="td whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                    {i.outstanding > 0 && (
                      <>
                        {i.paid === 0 && (
                          <button className="btn-ghost mr-1" onClick={() => setForm(i)}>
                            Edit
                          </button>
                        )}
                        <button
                          className="btn-ghost"
                          onClick={async () => {
                            const v = await ui.prompt(
                              `Payment for ${i.number ?? 'invoice'}`,
                              [
                                { name: 'date', label: 'Date received', type: 'date', defaultValue: new Date().toISOString().slice(0, 10) },
                                {
                                  name: 'amount',
                                  label: 'Amount received (IDR)',
                                  type: 'number',
                                  min: 1,
                                  defaultValue: String(i.outstanding),
                                  hint: `Outstanding ${rp(i.outstanding)}`,
                                },
                              ],
                              { submitLabel: 'Mark paid' },
                            )
                            if (!v) return
                            if (
                              await ui.run(
                                () => recordPaymentFn({ data: { transactionId: i.id, amount: Number(v.amount), date: v.date } }),
                                'Payment recorded',
                              )
                            )
                              await router.invalidate()
                          }}
                        >
                          Mark paid
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td className="td text-muted" colSpan={9}>
                    No {tab} invoices.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <InvoiceForm
          invoice={form === 'new' ? null : form}
          projects={projects}
          onClose={() => setForm(null)}
          onSaved={async () => {
            setForm(null)
            await router.invalidate()
          }}
        />
      )}
    </>
  )
}

function addDays(date: string, days: number) {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function InvoiceForm({
  invoice,
  projects,
  onClose,
  onSaved,
}: {
  invoice: TransactionRow | null
  projects: { id: number; code: string; name: string; client: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(invoice?.issue_date ?? today)
  const [terms, setTerms] = useState(invoice ? termsOf(invoice) : 'NET 30')
  const [due, setDue] = useState(invoice?.due_date ?? addDays(today, 30))
  const [err, setErr] = useState('')
  const applyTerms = (d: string, t: string) => {
    if (t === 'NET 14' || t === 'NET 30') setDue(addDays(d, t === 'NET 14' ? 14 : 30))
  }
  return (
    <Modal title={invoice ? 'Edit invoice' : 'New invoice'} onClose={onClose}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const common = {
            number: String(f.get('number') || ''),
            dpp: Number(f.get('dpp') || 0),
            issueDate: date,
            dueDate: due,
            withPpn: f.get('withPpn') === 'on',
            pphType: (f.get('pph23') === 'on' ? 'pph23' : 'none') as 'pph23' | 'none',
          }
          try {
            if (invoice) await updateTransactionFn({ data: { id: invoice.id, ...common } })
            else
              await recordTransactionFn({
                data: { kind: 'client_invoice', projectId: Number(f.get('projectId')), status: 'approved', ...common },
              })
            onSaved()
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
          }
        }}
      >
        {!invoice && (
          <label className="field sm:col-span-2">
            Project
            <Select
              name="projectId"
              required
              options={projects.map((p) => ({ value: String(p.id), label: `${p.code} — ${p.client} ${p.name}` }))}
            />
          </label>
        )}
        <label className="field">
          Invoice number
          <input className="input" name="number" defaultValue={invoice?.number ?? ''} />
        </label>
        <label className="field">
          Net amount (pre-VAT, IDR)
          <input className="input" name="dpp" type="number" min="0" defaultValue={invoice?.dpp} required />
        </label>
        <label className="field">
          Invoice date
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              applyTerms(e.target.value, terms)
            }}
          />
        </label>
        <label className="field">
          Payment terms
          <Select
            value={terms}
            onChange={(v) => {
              setTerms(v)
              applyTerms(date, v)
            }}
            options={['NET 14', 'NET 30', 'Other']}
          />
        </label>
        <label className="field">
          Due date
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <div className="flex flex-col justify-end gap-2 pb-1 text-[13px] text-ink-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="withPpn" defaultChecked={invoice ? invoice.ppn > 0 : true} /> VAT 11%
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="pph23" defaultChecked={invoice ? invoice.pph_type === 'pph23' : true} /> Client withholds PPh 23
            (2%)
          </label>
        </div>
        {err && <p className="text-[13px] text-bad sm:col-span-2">{err}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn-ghost py-2" onClick={onClose}>
            Cancel
          </button>
          <button className="btn">Save</button>
        </div>
      </form>
    </Modal>
  )
}
