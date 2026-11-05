import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { PPH_TYPES, TRANSACTION_KINDS } from '#/db/schema'
import type { TransactionRow } from '#/lib/finance'
import { KIND_LABEL, rp } from '#/lib/format'
import { recordPaymentFn, recordTransactionFn, setStatusFn } from '#/server/fns'

export function TransactionTable({ rows, showProject = true }: { rows: TransactionRow[]; showProject?: boolean }) {
  const router = useRouter()
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await router.invalidate()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="card overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className="th">Date</th>
            <th className="th">Kind</th>
            {showProject && <th className="th">Project</th>}
            <th className="th">Party / line</th>
            <th className="th">Description</th>
            <th className="th num">DPP</th>
            <th className="th num">Total</th>
            <th className="th num">Outstanding</th>
            <th className="th">Status</th>
            <th className="th" />
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className={t.status === 'void' ? 'opacity-40' : ''}>
              <td className="td whitespace-nowrap">
                {t.issue_date}
                {t.due_date && <div className={`text-xs ${t.overdue ? 'font-semibold text-red-700' : 'text-stone-500'}`}>due {t.due_date}</div>}
              </td>
              <td className="td">
                {KIND_LABEL[t.kind]}
                <div className="text-xs text-stone-500">{t.direction === 'in' ? 'money in' : 'money out'}</div>
              </td>
              {showProject && <td className="td">{t.project_code ?? t.category ?? '—'}</td>}
              <td className="td">
                {t.party ?? '—'}
                <div className="text-xs text-stone-500">{t.budget_line ?? ''}</div>
              </td>
              <td className="td max-w-56">{t.description}</td>
              <td className="td num">{rp(t.dpp)}</td>
              <td className="td num">
                {rp(t.total)}
                {(t.ppn > 0 || t.pph > 0) && (
                  <div className="text-xs text-stone-500">
                    +PPN {rp(t.ppn)}
                    {t.pph > 0 && ` −${t.pph_type.toUpperCase()} ${rp(t.pph)}`}
                  </div>
                )}
              </td>
              <td className="td num">{rp(t.outstanding)}</td>
              <td className="td">{t.status}</td>
              <td className="td whitespace-nowrap space-x-1">
                {t.status === 'draft' && (
                  <button className="btn-ghost" onClick={() => act(() => setStatusFn({ data: { id: t.id, status: 'approved' } }))}>
                    Approve
                  </button>
                )}
                {t.status !== 'void' && t.outstanding > 0 && (
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      const v = prompt(`Amount ${t.direction === 'in' ? 'received' : 'paid'} (outstanding ${rp(t.outstanding)})`, String(t.outstanding))
                      if (v) act(() => recordPaymentFn({ data: { transactionId: t.id, amount: Number(v) } }))
                    }}
                  >
                    {t.direction === 'in' ? 'Received' : 'Pay'}
                  </button>
                )}
                {t.kind === 'cash_advance' && t.status === 'approved' && t.outstanding === 0 && (
                  <button className="btn-ghost" onClick={() => act(() => setStatusFn({ data: { id: t.id, status: 'settled' } }))}>
                    Settle
                  </button>
                )}
                {t.status !== 'void' && t.paid === 0 && (
                  <button
                    className="btn-ghost"
                    onClick={() => confirm('Void this transaction?') && act(() => setStatusFn({ data: { id: t.id, status: 'void' } }))}
                  >
                    Void
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="td text-stone-500" colSpan={10}>
                Nothing here yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

type Line = { id: number; name: string }

/** Record form. With a project, spend goes on its budget lines; without, it is company spend. */
export function TransactionForm({
  projectId,
  lines = [],
  companies = [],
  categories = [],
}: {
  projectId?: number
  lines?: Line[]
  companies?: { id: number; name: string }[]
  categories?: { id: number; category: string }[]
}) {
  const router = useRouter()
  const [kind, setKind] = useState<(typeof TRANSACTION_KINDS)[number]>('vendor_bill')
  const [msg, setMsg] = useState('')
  return (
    <form
      className="card grid gap-3 p-4 md:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault()
        const form = e.currentTarget
        const f = new FormData(form)
        const s = (k: string) => (f.get(k) ? String(f.get(k)) : undefined)
        try {
          const res = await recordTransactionFn({
            data: {
              kind,
              projectId: projectId ?? null,
              budgetLineId: s('budgetLineId') ? Number(s('budgetLineId')) : null,
              companyId: s('companyId') ? Number(s('companyId')) : null,
              partyName: kind === 'client_invoice' ? undefined : s('partyName'),
              category: s('category'),
              description: s('description'),
              number: s('number'),
              issueDate: s('issueDate'),
              dueDate: s('dueDate'),
              dpp: Number(s('dpp') ?? 0),
              withPpn: f.get('withPpn') === 'on',
              pphType: (s('pphType') ?? 'none') as (typeof PPH_TYPES)[number],
              pph: s('pph') ? Number(s('pph')) : undefined,
              requestedBy: s('requestedBy'),
            },
          })
          setMsg(res.warning ?? 'Saved')
          form.reset()
          await router.invalidate()
        } catch (err) {
          setMsg(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      <label className="text-xs font-semibold text-stone-500">
        Kind
        <select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {TRANSACTION_KINDS.filter((k) => projectId || k !== 'client_invoice').map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {projectId ? (
        kind !== 'client_invoice' && (
          <label className="text-xs font-semibold text-stone-500">
            Budget line
            <select className="input mt-1" name="budgetLineId" required>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )
      ) : (
        <>
          <label className="text-xs font-semibold text-stone-500">
            Company
            <select className="input mt-1" name="companyId" required>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-stone-500">
            Category
            <input className="input mt-1" name="category" list="opex-categories" placeholder="Office Rental" />
            <datalist id="opex-categories">
              {categories.map((c) => (
                <option key={c.id} value={c.category} />
              ))}
            </datalist>
          </label>
        </>
      )}
      {kind !== 'client_invoice' && (
        <label className="text-xs font-semibold text-stone-500">
          {kind === 'vendor_bill' ? 'Vendor' : 'Employee'}
          <input className="input mt-1" name="partyName" required />
        </label>
      )}
      <label className="text-xs font-semibold text-stone-500">
        Number
        <input className="input mt-1" name="number" />
      </label>
      <label className="text-xs font-semibold text-stone-500">
        DPP (before tax)
        <input className="input mt-1" name="dpp" type="number" min="0" required />
      </label>
      <label className="flex items-end gap-2 pb-2 text-sm">
        <input type="checkbox" name="withPpn" defaultChecked /> PPN 11%
      </label>
      <label className="text-xs font-semibold text-stone-500">
        PPh
        <select className="input mt-1" name="pphType" defaultValue="none">
          {PPH_TYPES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold text-stone-500">
        PPh amount (optional)
        <input className="input mt-1" name="pph" type="number" min="0" placeholder="default rate" />
      </label>
      <label className="text-xs font-semibold text-stone-500">
        Issue date
        <input className="input mt-1" name="issueDate" type="date" />
      </label>
      <label className="text-xs font-semibold text-stone-500">
        Due date
        <input className="input mt-1" name="dueDate" type="date" />
      </label>
      <label className="text-xs font-semibold text-stone-500">
        Requested by
        <input className="input mt-1" name="requestedBy" />
      </label>
      <label className="text-xs font-semibold text-stone-500 md:col-span-2">
        Description
        <input className="input mt-1" name="description" />
      </label>
      <div className="flex items-end gap-3 md:col-span-2">
        <button className="btn">Record</button>
        {msg && <span className="text-sm text-stone-600">{msg}</span>}
      </div>
    </form>
  )
}
