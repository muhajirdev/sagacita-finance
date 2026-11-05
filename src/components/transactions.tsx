import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { PPH_TYPES, TRANSACTION_KINDS } from '#/db/schema'
import type { TransactionRow } from '#/lib/finance'
import { StatusPill } from '#/components/ui'
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
      <table className="table">
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
                {t.due_date && <div className={`text-[12px] ${t.overdue ? 'font-semibold text-bad' : 'text-muted'}`}>due {t.due_date}</div>}
              </td>
              <td className="td">
                {KIND_LABEL[t.kind]}
                <div className="text-[12px] text-muted">{t.direction === 'in' ? 'money in' : 'money out'}</div>
              </td>
              {showProject && <td className="td">{t.project_code ?? t.category ?? '—'}</td>}
              <td className="td">
                {t.party ?? '—'}
                <div className="text-[12px] text-muted">{t.budget_line ?? ''}</div>
              </td>
              <td className="td max-w-56">{t.description}</td>
              <td className="td num">{rp(t.dpp)}</td>
              <td className="td num">
                {rp(t.total)}
                {(t.ppn > 0 || t.pph > 0) && (
                  <div className="text-[12px] text-muted">
                    +PPN {rp(t.ppn)}
                    {t.pph > 0 && ` −${t.pph_type.toUpperCase()} ${rp(t.pph)}`}
                  </div>
                )}
              </td>
              <td className="td num">{rp(t.outstanding)}</td>
              <td className="td">
                <StatusPill status={t.status} overdue={!!t.overdue} />
              </td>
              <td className="td whitespace-nowrap space-x-1 text-right">
                {t.status === 'draft' && (
                  <button className="btn-ghost" onClick={() => act(() => setStatusFn({ data: { id: t.id, status: 'approved' } }))}>
                    Approve
                  </button>
                )}
                {t.status !== 'void' && t.outstanding > 0 && (
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      const v = prompt(
                        `Amount ${t.direction === 'in' ? 'received' : 'paid'} (outstanding ${rp(t.outstanding)})`,
                        String(t.outstanding),
                      )
                      if (v)
                        act(() =>
                          recordPaymentFn({
                            data: { transactionId: t.id, amount: Number(v) },
                          }),
                        )
                    }}
                  >
                    {t.direction === 'in' ? 'Received' : 'Pay'}
                  </button>
                )}
                {t.kind === 'cash_advance' && t.status === 'approved' && t.outstanding === 0 && (
                  <button
                    className="btn-ghost"
                    onClick={() =>
                      act(() =>
                        setStatusFn({
                          data: { id: t.id, status: 'settled' },
                        }),
                      )
                    }
                  >
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
              <td className="td text-muted" colSpan={10}>
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
      className="card grid gap-4 p-5 md:grid-cols-4"
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
      <label className="field">
        Kind
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {TRANSACTION_KINDS.filter((k) => projectId || k !== 'client_invoice').map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {projectId ? (
        kind !== 'client_invoice' && (
          <label className="field">
            Budget line
            <select className="input" name="budgetLineId" required>
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
          <label className="field">
            Company
            <select className="input" name="companyId" required>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Category
            <input className="input" name="category" list="opex-categories" placeholder="Office Rental" />
            <datalist id="opex-categories">
              {categories.map((c) => (
                <option key={c.id} value={c.category} />
              ))}
            </datalist>
          </label>
        </>
      )}
      {kind !== 'client_invoice' && (
        <label className="field">
          {kind === 'vendor_bill' ? 'Vendor' : 'Employee'}
          <input className="input" name="partyName" required />
        </label>
      )}
      <label className="field">
        Number
        <input className="input" name="number" />
      </label>
      <label className="field">
        DPP (before tax)
        <input className="input" name="dpp" type="number" min="0" required />
      </label>
      <label className="flex items-end gap-2 pb-2.5 text-[13px] text-ink-2">
        <input type="checkbox" name="withPpn" defaultChecked /> PPN 11%
      </label>
      <label className="field">
        PPh
        <select className="input" name="pphType" defaultValue="none">
          {PPH_TYPES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="field">
        PPh amount (optional)
        <input className="input" name="pph" type="number" min="0" placeholder="default rate" />
      </label>
      <label className="field">
        Issue date
        <input className="input" name="issueDate" type="date" />
      </label>
      <label className="field">
        Due date
        <input className="input" name="dueDate" type="date" />
      </label>
      <label className="field">
        Requested by
        <input className="input" name="requestedBy" />
      </label>
      <label className="field md:col-span-2">
        Description
        <input className="input" name="description" />
      </label>
      <div className="flex items-end gap-3 md:col-span-2">
        <button className="btn">Record</button>
        {msg && <span className="text-sm text-ink-2">{msg}</span>}
      </div>
    </form>
  )
}
