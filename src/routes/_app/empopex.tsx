import { createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { useState } from 'react'

import { MONTHS, Modal, PageHeader, Stat } from '#/components/ui'
import { rp, rpShort } from '#/lib/format'
import { copyPayrollFn, getPayroll, savePayrollFn, setPayrollStatusFn } from '#/server/pages'
import { Select, ui } from '#/components/dialogs'

export const Route = createFileRoute('/_app/empopex')({
  validateSearch: z.object({ year: z.coerce.number().int().optional() }),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: async ({ deps }) => {
    return getPayroll({ data: { year: deps.year } })
  },
  component: EmployeeOpex,
})

function EmployeeOpex() {
  const { year, rows, divisions, canApprove } = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  // The month being entered or edited (YYYY-MM); null = closed.
  const [open, setOpen] = useState<string | null>(null)
  const [divisionId, setDivisionId] = useState<number>(divisions[0]?.id ?? 0)
  const sum = (k: 'netSalary' | 'allowance' | 'bpjsTk' | 'bpjsKes' | 'pph21') => rows.reduce((a, r) => a + r[k], 0)
  const cost = (r: (typeof rows)[number]) => r.netSalary + r.allowance + r.bpjsTk + r.bpjsKes + r.pph21
  const grand = rows.reduce((a, r) => a + cost(r), 0)
  const periods = [...new Set(rows.map((r) => r.period))]
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const nextOf = (p: string) => {
    const [y, m] = p.split('-').map(Number)
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  const monthLabel = (p: string) => MONTHS[Number(p.slice(5)) - 1] + ' ' + p.slice(0, 4)
  const copyMonth = async () => {
    const def = periods.length ? nextOf(periods[periods.length - 1]) : thisMonth
    const v = await ui.prompt(
      'Copy from previous month',
      [
        { name: 'month', label: 'New month', type: 'select', defaultValue: String(Number(def.slice(5))), options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) },
        { name: 'year', label: 'Year', type: 'number', defaultValue: def.slice(0, 4) },
      ],
      { message: 'Copies every division from the month before as a draft. Edit the amounts (raises, new hires), then the owner approves.', submitLabel: 'Copy' },
    )
    if (!v) return
    const period = `${v.year}-${String(v.month).padStart(2, '0')}`
    if (await ui.run(() => copyPayrollFn({ data: { period } }), `${monthLabel(period)} drafted from the month before`)) {
      if (Number(v.year) !== year) navigate({ search: { year: Number(v.year) } })
      else await router.invalidate()
    }
  }
  const editing = open ? rows.find((r) => r.period === open && r.divisionId === divisionId) : undefined

  return (
    <>
      <PageHeader
        title="Payroll"
        sub="Monthly payroll per division: salary, allowance, BPJS and PPh 21. HR enters each month, the owner approves it. Owner and HR only."
        right={
          <div className="flex items-center gap-2">
            <Select
              value={String(year)}
              onChange={(v) => navigate({ search: { year: Number(v) } })}
              options={[2025, 2026, 2027].map((y) => ({ value: String(y), label: String(y) }))}
            />
            <button className="btn-ghost whitespace-nowrap" onClick={copyMonth}>
              Copy from previous month
            </button>
            <button className="btn whitespace-nowrap" onClick={() => setOpen(thisMonth)}>
              + Enter month
            </button>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="Total Employee OpEx" value={rpShort(grand)} sub={`${year} YTD`} tone="accent" />
        <Stat label="Salary" value={rpShort(sum('netSalary'))} />
        <Stat label="Allowance" value={rpShort(sum('allowance'))} sub="tunjangan" />
        <Stat label="BPJS TK (Company)" value={rpShort(sum('bpjsTk'))} />
        <Stat label="BPJS Kes (Company)" value={rpShort(sum('bpjsKes'))} />
        <Stat label="PPh 21" value={rpShort(sum('pph21'))} sub="employee income tax" />
      </div>

      <h2 className="mb-3 mt-10 text-[15px] font-semibold">Monthly breakdown · {year}</h2>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Month</th>
              {divisions.map((d) => (
                <th key={d.id} className="th num">
                  {d.name}
                </th>
              ))}
              <th className="th num">Allowance</th>
              <th className="th num">BPJS TK</th>
              <th className="th num">BPJS Kes</th>
              <th className="th num">PPh</th>
              <th className="th num">Total</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              const m = rows.filter((r) => r.period === period)
              const s = (k: 'allowance' | 'bpjsTk' | 'bpjsKes' | 'pph21') => m.reduce((a, r) => a + r[k], 0)
              return (
                <tr key={period}>
                  <td className="td font-medium">{MONTHS[Number(period.slice(5)) - 1]}</td>
                  {divisions.map((d) => (
                    <td key={d.id} className="td num">
                      {rp(m.find((r) => r.divisionId === d.id)?.netSalary ?? 0)}
                    </td>
                  ))}
                  <td className="td num">{rp(s('allowance'))}</td>
                  <td className="td num">{rp(s('bpjsTk'))}</td>
                  <td className="td num">{rp(s('bpjsKes'))}</td>
                  <td className="td num">{rp(s('pph21'))}</td>
                  <td className="td num font-semibold">{rp(m.reduce((a, r) => a + cost(r), 0))}</td>
                  <td className="td whitespace-nowrap">
                    {(() => {
                      const approved = m.every((r) => r.status === 'approved')
                      const label = monthLabel(period)
                      return (
                        <div className="flex items-center gap-2">
                          <span className={approved ? 'pill-good' : 'pill-warn'} title={approved && m[0]?.approvedBy ? `Approved by ${m[0].approvedBy}` : ''}>
                            {approved ? 'Approved by owner' : 'Waiting owner approval'}
                          </span>
                          {!approved && (
                            <button className="btn-ghost" onClick={() => setOpen(period)}>
                              Edit
                            </button>
                          )}
                          {canApprove && (
                            <button
                              className="btn-ghost"
                              title={approved ? m[0]?.approvedBy ? `Approved by ${m[0].approvedBy}` : '' : ''}
                              onClick={async () => {
                                const ok = await ui.confirm(
                                  approved ? `Reopen ${label} payroll?` : `Approve ${label} payroll?`,
                                  {
                                    message: approved
                                      ? 'HR can edit it again. It will need approval again.'
                                      : `Total ${rp(m.reduce((a, r) => a + cost(r), 0))}. The month is locked after approval.`,
                                    confirmLabel: approved ? 'Reopen' : 'Approve',
                                  },
                                )
                                if (!ok) return
                                if (
                                  await ui.run(
                                    () => setPayrollStatusFn({ data: { period, status: approved ? 'draft' : 'approved' } }),
                                    approved ? 'Reopened' : 'Approved',
                                  )
                                )
                                  await router.invalidate()
                              }}
                            >
                              {approved ? 'Reopen' : 'Approve'}
                            </button>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                </tr>
              )
            })}
            {periods.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={divisions.length + 7}>
                  No payroll entered yet. Use "Enter month".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-muted">
        Division columns are salary. Allowance, BPJS and PPh are totals across divisions. Each month keeps its own amounts, so a raise only
        changes the months after it. HR enters or copies each month, the owner approves it, and an approved month is locked until the owner reopens it.
      </p>

      {open && (
        <Modal title={`Payroll · ${monthLabel(open)}`} onClose={() => setOpen(null)}>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              const n = (k: string) => Number(f.get(k) || 0)
              try {
                await savePayrollFn({
                  data: {
                    period: `${f.get('year')}-${String(f.get('month')).padStart(2, '0')}`,
                    divisionId: n('divisionId'),
                    netSalary: n('netSalary'),
                    allowance: n('allowance'),
                    bpjsTk: n('bpjsTk'),
                    bpjsKes: n('bpjsKes'),
                    pph21: n('pph21'),
                    headcount: f.get('headcount') ? n('headcount') : undefined,
                  },
                })
                setOpen(null)
                await router.invalidate()
              } catch (err) {
                ui.error(err)
              }
            }}
          >
            <label className="field">
              Month
              <Select
                name="month"
                value={String(Number(open.slice(5)))}
                onChange={(v) => setOpen(`${open.slice(0, 4)}-${String(v).padStart(2, '0')}`)}
                options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              />
            </label>
            <label className="field">
              Year
              <input
                className="input"
                name="year"
                type="number"
                defaultValue={open.slice(0, 4)}
                onChange={(e) => /^\d{4}$/.test(e.target.value) && setOpen(`${e.target.value}-${open.slice(5)}`)}
              />
            </label>
            <label className="field sm:col-span-2">
              Division
              <Select
                name="divisionId"
                value={String(divisionId)}
                onChange={(v) => setDivisionId(Number(v))}
                options={divisions.map((d) => ({ value: String(d.id), label: d.name }))}
              />
            </label>
            {/* key resets the amounts to the saved month + division when either changes */}
            <div key={`${open}-${divisionId}`} className="contents">
              <label className="field">
                Salary total
                <input className="input" name="netSalary" type="number" min="0" required defaultValue={editing?.netSalary ?? ''} />
              </label>
              <label className="field">
                Allowance total (tunjangan)
                <input className="input" name="allowance" type="number" min="0" defaultValue={editing?.allowance ?? ''} />
              </label>
              <label className="field">
                BPJS TK (company)
                <input className="input" name="bpjsTk" type="number" min="0" defaultValue={editing?.bpjsTk ?? ''} />
              </label>
              <label className="field">
                BPJS Kes (company)
                <input className="input" name="bpjsKes" type="number" min="0" defaultValue={editing?.bpjsKes ?? ''} />
              </label>
              <label className="field">
                PPh 21 total
                <input className="input" name="pph21" type="number" min="0" defaultValue={editing?.pph21 ?? ''} />
              </label>
              <label className="field">
                Headcount (optional)
                <input className="input" name="headcount" type="number" min="0" defaultValue={editing?.headcount ?? ''} />
              </label>
            </div>
            <p className="self-end text-[12px] text-muted">Saving the same month and division again replaces it.</p>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className="btn-ghost py-2" onClick={() => setOpen(null)}>
                Cancel
              </button>
              <button className="btn">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

