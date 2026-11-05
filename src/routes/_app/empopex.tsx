import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { MONTHS, Modal, PageHeader, Stat } from '#/components/ui'
import { rp, rpShort } from '#/lib/format'
import { getPayroll, savePayrollFn } from '#/server/pages'

export const Route = createFileRoute('/_app/empopex')({
  loader: () => getPayroll({ data: {} }),
  component: EmployeeOpex,
})

function EmployeeOpex() {
  const { year, rows, divisions } = Route.useLoaderData()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const sum = (k: 'netSalary' | 'bpjsTk' | 'bpjsKes' | 'pph21') => rows.reduce((a, r) => a + r[k], 0)
  const cost = (r: (typeof rows)[number]) => r.netSalary + r.bpjsTk + r.bpjsKes + r.pph21
  const grand = rows.reduce((a, r) => a + cost(r), 0)
  const periods = [...new Set(rows.map((r) => r.period))]

  return (
    <>
      <PageHeader
        title="Employee OpEx"
        sub="Monthly payroll totals per division. Owner and HR only on the web."
        right={
          <button className="btn" onClick={() => setOpen(true)}>
            + Enter month
          </button>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Total Employee OpEx" value={rpShort(grand)} sub={`${year} YTD`} tone="accent" />
        <Stat label="Net Salary Paid" value={rpShort(sum('netSalary'))} />
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
              <th className="th num">BPJS TK</th>
              <th className="th num">BPJS Kes</th>
              <th className="th num">PPh</th>
              <th className="th num">Total</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              const m = rows.filter((r) => r.period === period)
              const s = (k: 'bpjsTk' | 'bpjsKes' | 'pph21') => m.reduce((a, r) => a + r[k], 0)
              return (
                <tr key={period}>
                  <td className="td font-medium">{MONTHS[Number(period.slice(5)) - 1]}</td>
                  {divisions.map((d) => (
                    <td key={d.id} className="td num">
                      {rp(m.find((r) => r.divisionId === d.id)?.netSalary ?? 0)}
                    </td>
                  ))}
                  <td className="td num">{rp(s('bpjsTk'))}</td>
                  <td className="td num">{rp(s('bpjsKes'))}</td>
                  <td className="td num">{rp(s('pph21'))}</td>
                  <td className="td num font-semibold">{rp(m.reduce((a, r) => a + cost(r), 0))}</td>
                </tr>
              )
            })}
            {periods.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={divisions.length + 5}>
                  No payroll entered yet. Use "Enter month".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-muted">Division columns are net salary. BPJS and PPh are the company totals across divisions.</p>

      {open && (
        <Modal title="Enter monthly payroll" onClose={() => setOpen(false)}>
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
                    bpjsTk: n('bpjsTk'),
                    bpjsKes: n('bpjsKes'),
                    pph21: n('pph21'),
                    headcount: f.get('headcount') ? n('headcount') : undefined,
                  },
                })
                setOpen(false)
                await router.invalidate()
              } catch (err) {
                alert(err instanceof Error ? err.message : String(err))
              }
            }}
          >
            <label className="field">
              Month
              <select className="input" name="month" defaultValue={new Date().getMonth() + 1}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Year
              <input className="input" name="year" type="number" defaultValue={year} />
            </label>
            <label className="field sm:col-span-2">
              Division
              <select className="input" name="divisionId">
                {divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Net salary total
              <input className="input" name="netSalary" type="number" min="0" required />
            </label>
            <label className="field">
              PPh 21 total
              <input className="input" name="pph21" type="number" min="0" />
            </label>
            <label className="field">
              BPJS TK (company)
              <input className="input" name="bpjsTk" type="number" min="0" />
            </label>
            <label className="field">
              BPJS Kes (company)
              <input className="input" name="bpjsKes" type="number" min="0" />
            </label>
            <label className="field">
              Headcount (optional)
              <input className="input" name="headcount" type="number" min="0" />
            </label>
            <p className="self-end text-[12px] text-muted">Saving the same month and division again replaces it.</p>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className="btn-ghost py-2" onClick={() => setOpen(false)}>
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
