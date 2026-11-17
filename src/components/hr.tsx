import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { Modal } from '#/components/ui'
import { rp } from '#/lib/format'
import { getEmployees, getMedicalClaims, medicalClaimFn, saveEmployeeFn } from '#/server/pages'
import { Select, ui } from '#/components/dialogs'

/** HR sections: the employee database and medical reimbursement. Payroll stays on /empopex. */
type Employee = Awaited<ReturnType<typeof getEmployees>>[number]

export function Employees({ employees, divisions }: { employees: Employee[]; divisions: { id: number; name: string }[] }) {
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
              <th className="th">NIK (KTP)</th>
              <th className="th">NPWP</th>
              <th className="th num">Base salary</th>
              <th className="th">Contract</th>
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
                <td className="td text-[12px]">
                  {e.contract ? (
                    <a className="text-accent hover:underline" href={`/files/${e.contract.id}`} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
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
                <td className="td text-muted" colSpan={9}>
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
              const file = f.get('contract')
              const ok = await ui.run(async () => {
                const row = await saveEmployeeFn({
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
                      medicalLimit: s('medicalLimit') ? Number(s('medicalLimit')) : null,
                    },
                  })
                if (file instanceof File && file.size > 0) {
                  const body = new FormData()
                  body.append('file', file)
                  body.append('kind', 'contract')
                  const res = await fetch(`/files/${row.id}?entity=employee`, { method: 'POST', body })
                  if (!res.ok) throw new Error(`Employee saved, but the contract upload failed: ${await res.text()}`)
                }
              }, 'Employee saved')
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
              NIK (KTP)
              <input
                className="input"
                name="ktp"
                defaultValue={edit.ktp ?? ''}
                required
                inputMode="numeric"
                pattern="[0-9 .\-]*"
                placeholder="16 digits"
                onInput={(ev) => {
                  const el = ev.currentTarget
                  el.setCustomValidity(el.value.replace(/[\s.-]/g, '').length === 16 ? '' : 'NIK must be 16 digits')
                }}
              />
            </label>
            <label className="field">
              NPWP (optional)
              <input className="input" name="npwp" defaultValue={edit.npwp ?? ''} placeholder="15 or 16 digits" />
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
            <label className="field">
              Medical ceiling (yearly)
              <input
                className="input"
                name="medicalLimit"
                type="number"
                min="0"
                defaultValue={edit.medicalLimit ?? ''}
                placeholder="Empty = no limit"
              />
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
            <label className="field sm:col-span-2">
              Employment contract (PDF)
              <input className="input" name="contract" type="file" accept="application/pdf,.pdf" />
              {edit.contract && (
                <span className="text-[12px] text-muted">
                  Current:{' '}
                  <a className="text-accent hover:underline" href={`/files/${edit.contract.id}`} target="_blank" rel="noreferrer">
                    {edit.contract.filename}
                  </a>
                  . Uploading a new file keeps the old one in the history.
                </span>
              )}
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

const MEDICAL_TYPES = ['Outpatient', 'Inpatient', 'Dental', 'Vision']

export function MedicalClaims({ data, employees, year }: { data: Awaited<ReturnType<typeof getMedicalClaims>>; employees: Employee[]; year: number }) {
  const router = useRouter()
  const { claims, usage } = data
  const use = new Map(usage.map((u) => [u.party, u]))
  const balances = employees
    .filter((e) => !e.endDate || e.medicalLimit != null || use.has(e.name))
    .map((e) => {
      const u = use.get(e.name)
      const used = u?.used ?? 0
      const pending = u?.pending ?? 0
      return { e, used, pending, left: e.medicalLimit == null ? null : e.medicalLimit - used - pending }
    })
  const setLimit = async (e: Employee) => {
    const v = await ui.prompt(`Medical allowance for ${e.name}`, [
      {
        name: 'limit',
        label: 'Yearly limit (IDR)',
        type: 'number',
        min: 0,
        required: false,
        defaultValue: e.medicalLimit == null ? '' : String(e.medicalLimit),
        hint: 'Leave empty for no limit',
      },
    ])
    if (!v) return
    const { id, createdAt: _c, updatedAt: _u, contract: _k, ...rest } = e
    if (
      await ui.run(
        () => saveEmployeeFn({ data: { ...rest, id, medicalLimit: v.limit === '' ? null : Number(v.limit) } }),
        'Medical allowance saved',
      )
    )
      await router.invalidate()
  }
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
                { name: 'type', label: 'Type', type: 'select', options: MEDICAL_TYPES.map((t) => ({ value: t, label: t })) },
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
                  medicalClaimFn({ data: { employeeId: Number(v.employeeId), type: v.type, amount: Number(v.amount), date: v.date, description: v.description } }),
                'Claim submitted for approval',
              )
            )
              await router.invalidate()
          }}
        >
          + Medical claim
        </button>
      </div>
      <div className="card mb-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Employee</th>
              <th className="th num">Yearly limit</th>
              <th className="th num">Used (approved)</th>
              <th className="th num">Waiting approval</th>
              <th className="th num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {balances.map(({ e, used, pending, left }) => (
              <tr key={e.id}>
                <td className="td">{e.name}</td>
                <td className="td num">
                  <button className="tabular-nums hover:text-accent" title="Change limit" onClick={() => setLimit(e)}>
                    {e.medicalLimit == null ? <span className="text-accent">+ Set</span> : rp(e.medicalLimit)}
                  </button>
                </td>
                <td className="td num">{rp(used)}</td>
                <td className="td num text-muted">{pending ? rp(pending) : '—'}</td>
                <td className={`td num font-medium ${left != null && left < 0 ? 'text-bad' : ''}`}>{left == null ? '—' : rp(left)}</td>
              </tr>
            ))}
            {balances.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={5}>
                  No employees yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
                <td className="td text-ink-2">{(c.description ?? '').replace(/^Medical claim:? ?/, '')}</td>
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
