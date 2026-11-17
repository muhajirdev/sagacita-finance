import { createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { useState } from 'react'

import { MONTHS, Modal, PageHeader, Stat } from '#/components/ui'
import { rp, rpShort } from '#/lib/format'
import { getEmployees, getMedicalClaims, getPayroll, medicalClaimFn, saveEmployeeFn, savePayrollFn, setPayrollStatusFn } from '#/server/pages'
import { Select, ui } from '#/components/dialogs'

export const Route = createFileRoute('/_app/empopex')({
  validateSearch: z.object({ year: z.coerce.number().int().optional() }),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: async ({ deps }) => {
    const payroll = await getPayroll({ data: { year: deps.year } })
    return { ...payroll, employees: await getEmployees(), claims: await getMedicalClaims({ data: { year: payroll.year } }) }
  },
  component: EmployeeOpex,
})

function EmployeeOpex() {
  const { year, rows, divisions, employees, canApprove, claims } = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
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
          <div className="flex items-center gap-2">
            <Select
              value={String(year)}
              onChange={(v) => navigate({ search: { year: Number(v) } })}
              options={[2025, 2026, 2027].map((y) => ({ value: String(y), label: String(y) }))}
            />
            <button className="btn whitespace-nowrap" onClick={() => setOpen(true)}>
              + Enter month
            </button>
          </div>
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
              <th className="th">Status</th>
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
                  <td className="td whitespace-nowrap">
                    {(() => {
                      const approved = m.every((r) => r.status === 'approved')
                      const label = MONTHS[Number(period.slice(5)) - 1] + ' ' + period.slice(0, 4)
                      return (
                        <div className="flex items-center gap-2">
                          <span className={approved ? 'pill-good' : 'pill-warn'}>
                            {approved ? 'Approved' : 'Waiting BOD'}
                          </span>
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
                <td className="td text-muted" colSpan={divisions.length + 6}>
                  No payroll entered yet. Use "Enter month".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-muted">Division columns are net salary. BPJS and PPh are the company totals across divisions. HR enters each month, the BOD approves it, and an approved month is locked.</p>

      <MedicalClaims claims={claims} employees={employees} year={year} />
      <Employees employees={employees} divisions={divisions} />

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
                ui.error(err)
              }
            }}
          >
            <label className="field">
              Month
              <Select
                name="month"
                defaultValue={String(new Date().getMonth() + 1)}
                options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              />
            </label>
            <label className="field">
              Year
              <input className="input" name="year" type="number" defaultValue={year} />
            </label>
            <label className="field sm:col-span-2">
              Division
              <Select name="divisionId" options={divisions.map((d) => ({ value: String(d.id), label: d.name }))} />
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

type Employee = Awaited<ReturnType<typeof getEmployees>>[number]

function Employees({ employees, divisions }: { employees: Employee[]; divisions: { id: number; name: string }[] }) {
  const router = useRouter()
  const [edit, setEdit] = useState<Partial<Employee> | null>(null)
  const divName = (id: number | null | undefined) => divisions.find((d) => d.id === id)?.name ?? '—'
  return (
    <>
      <div className="mb-3 mt-10 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Employees · {employees.filter((e) => !e.endDate).length} active</h2>
        <button className="btn-ghost" onClick={() => setEdit({})}>
          + Add employee
        </button>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Name</th>
              <th className="th">Position</th>
              <th className="th">Division</th>
              <th className="th">KTP</th>
              <th className="th">NPWP</th>
              <th className="th num">Base salary</th>
              <th className="th">Start</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className={e.endDate ? 'opacity-50' : ''}>
                <td className="td font-medium">{e.name}</td>
                <td className="td">{e.position ?? '—'}</td>
                <td className="td">{divName(e.divisionId)}</td>
                <td className="td font-mono text-[12px]">{e.ktp ?? '—'}</td>
                <td className="td font-mono text-[12px]">{e.npwp ?? '—'}</td>
                <td className="td num">{e.baseSalary != null ? rp(e.baseSalary) : '—'}</td>
                <td className="td whitespace-nowrap text-[12px]">{e.startDate ?? '—'}</td>
                <td className="td">
                  <button className="btn-ghost" onClick={() => setEdit(e)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={8}>
                  No employees yet. Use "Add employee".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : 'Add employee'} onClose={() => setEdit(null)}>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (ev) => {
              ev.preventDefault()
              const f = new FormData(ev.currentTarget)
              const s = (k: string) => String(f.get(k) ?? '').trim() || null
              const salary = s('baseSalary')
              const div = s('divisionId')
              const ok = await ui.run(
                () =>
                  saveEmployeeFn({
                    data: {
                      id: edit.id,
                      name: s('name') ?? '',
                      position: s('position'),
                      divisionId: div ? Number(div) : null,
                      ktp: s('ktp'),
                      npwp: s('npwp'),
                      ptkp: s('ptkp'),
                      bpjsTkNo: s('bpjsTkNo'),
                      bpjsKesNo: s('bpjsKesNo'),
                      address: s('address'),
                      phone: s('phone'),
                      bankAccount: s('bankAccount'),
                      baseSalary: salary ? Number(salary) : null,
                      startDate: s('startDate'),
                      endDate: s('endDate'),
                      notes: s('notes'),
                    },
                  }),
                'Employee saved',
              )
              if (ok) {
                setEdit(null)
                await router.invalidate()
              }
            }}
          >
            <label className="field">
              Name
              <input className="input" name="name" defaultValue={edit.name ?? ''} required />
            </label>
            <label className="field">
              Position
              <input className="input" name="position" defaultValue={edit.position ?? ''} />
            </label>
            <label className="field">
              Division
              <Select
                name="divisionId"
                defaultValue={String(edit.divisionId ?? divisions[0]?.id)}
                options={divisions.map((d) => ({ value: String(d.id), label: d.name }))}
              />
            </label>
            <label className="field">
              Base salary (monthly)
              <input className="input" name="baseSalary" type="number" min="0" defaultValue={edit.baseSalary ?? ''} />
            </label>
            <label className="field">
              KTP (NIK)
              <input className="input" name="ktp" defaultValue={edit.ktp ?? ''} />
            </label>
            <label className="field">
              NPWP
              <input className="input" name="npwp" defaultValue={edit.npwp ?? ''} />
            </label>
            <label className="field">
              PTKP status
              <Select
                name="ptkp"
                defaultValue={edit.ptkp ?? 'TK/0'}
                options={['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3']}
              />
            </label>
            <label className="field">
              BPJS Ketenagakerjaan no.
              <input className="input" name="bpjsTkNo" defaultValue={edit.bpjsTkNo ?? ''} />
            </label>
            <label className="field">
              BPJS Kesehatan no.
              <input className="input" name="bpjsKesNo" defaultValue={edit.bpjsKesNo ?? ''} />
            </label>
            <label className="field sm:col-span-2">
              Address
              <input className="input" name="address" defaultValue={edit.address ?? ''} />
            </label>
            <label className="field">
              Phone
              <input className="input" name="phone" defaultValue={edit.phone ?? ''} />
            </label>
            <label className="field">
              Bank account
              <input className="input" name="bankAccount" defaultValue={edit.bankAccount ?? ''} placeholder="BCA 1234567890" />
            </label>
            <label className="field">
              Start date
              <input className="input" name="startDate" type="date" defaultValue={edit.startDate ?? ''} />
            </label>
            <label className="field">
              End date (if left)
              <input className="input" name="endDate" type="date" defaultValue={edit.endDate ?? ''} />
            </label>
            <label className="field sm:col-span-2">
              Notes
              <input className="input" name="notes" defaultValue={edit.notes ?? ''} />
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className="btn-ghost py-2" onClick={() => setEdit(null)}>
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

function MedicalClaims({
  claims,
  employees,
  year,
}: {
  claims: Awaited<ReturnType<typeof getMedicalClaims>>
  employees: Employee[]
  year: number
}) {
  const router = useRouter()
  const state = (c: (typeof claims)[number]) =>
    c.status === 'draft' ? (
      <span className="pill-warn">Waiting approval</span>
    ) : c.outstanding <= 0 ? (
      <span className="pill-good">Paid</span>
    ) : (
      <span className="pill-neutral">Approved, unpaid</span>
    )
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">
          Medical reimbursement · {year} · {rp(claims.reduce((a, c) => a + c.total, 0))}
        </h2>
        <button
          className="btn-ghost"
          onClick={async () => {
            const v = await ui.prompt(
              'Medical claim',
              [
                {
                  name: 'employeeId',
                  label: 'Employee',
                  type: 'select',
                  options: employees.filter((e) => !e.endDate).map((e) => ({ value: String(e.id), label: e.name })),
                },
                { name: 'amount', label: 'Amount on the receipt (IDR)', type: 'number', min: 1 },
                { name: 'date', label: 'Receipt date', type: 'date', defaultValue: new Date().toISOString().slice(0, 10) },
                { name: 'description', label: 'Clinic / note', required: false },
              ],
              { message: 'Goes to Approvals like any expense, then into the payment run.', submitLabel: 'Submit claim' },
            )
            if (!v) return
            if (
              await ui.run(
                () =>
                  medicalClaimFn({ data: { employeeId: Number(v.employeeId), amount: Number(v.amount), date: v.date, description: v.description } }),
                'Claim submitted for approval',
              )
            )
              await router.invalidate()
          }}
        >
          + Medical claim
        </button>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Employee</th>
              <th className="th">Note</th>
              <th className="th num">Amount</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id}>
                <td className="td whitespace-nowrap">{c.issue_date}</td>
                <td className="td">{c.party ?? '—'}</td>
                <td className="td text-ink-2">{(c.description ?? '').replace(/^Medical claim: /, '')}</td>
                <td className="td num">{rp(c.total)}</td>
                <td className="td">{state(c)}</td>
              </tr>
            ))}
            {claims.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={5}>
                  No medical claims in {year}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
