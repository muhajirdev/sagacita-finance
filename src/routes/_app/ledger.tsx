import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import type { Cell } from 'write-excel-file'

import { PageHeader } from '#/components/ui'
import { ui } from '#/components/dialogs'
import { FilterBar } from '#/components/filter-bar'
import { filterSearch, pickFilters, rangeLabel } from '#/lib/filters'
import { rp } from '#/lib/format'
import { getReference } from '#/server/fns'
import { getLedger } from '#/server/pages'

export const Route = createFileRoute('/_app/ledger')({
  validateSearch: filterSearch,
  loaderDeps: ({ search }) => pickFilters(search),
  loader: async ({ deps }) => {
    const [d, ref] = await Promise.all([getLedger({ data: deps }), getReference()])
    return { ...d, ref, label: rangeLabel(deps) }
  },
  component: Ledger,
})

type LedgerData = Awaited<ReturnType<typeof getLedger>> & { label: string }

const GROUP_LABEL: Record<string, string> = {
  revenue: 'Revenue',
  cost_of_service: 'Cost of Service',
  operating_expense: 'Operating Expenses',
  other_income: 'Other Income',
  other_expense: 'Other Expenses',
  income_tax: 'PPh Final PP 55',
}

const accLabel = (a: { code: string | null; name: string }) => (a.code ? `${a.code}  ${a.name}` : a.name)

/** Excel: "Buku Besar" sheet with one block per account (like a GL printout) and a flat "Data" sheet for pivots. */
async function downloadXlsx(d: LedgerData) {
  const { default: writeXlsxFile } = await import('write-excel-file')
  const num = (v: number, bold = false): Cell => ({ value: Math.round(v), type: Number, format: '#,##0;(#,##0)', fontWeight: bold ? 'bold' : undefined })
  const txt = (v: string | null, bold = false): Cell => (v ? { value: v, fontWeight: bold ? 'bold' : undefined } : null)
  const header = ['Date', 'No.', 'Description', 'Project', 'Vendor / Client', 'Division', 'Debit', 'Credit', 'Balance'].map((h) => txt(h, true))
  const gl: Cell[][] = [[txt(d.company.name.toUpperCase(), true)], [txt('BUKU BESAR (GENERAL LEDGER)', true)], [txt(d.label, true)]]
  for (const a of d.accounts) {
    gl.push([], [txt(accLabel(a), true), null, txt(GROUP_LABEL[a.group] ?? a.group)], header)
    for (const e of a.entries)
      gl.push([txt(e.date), txt(e.number), txt(e.description), txt(e.project), txt(e.party), txt(e.division), num(e.debit), num(e.credit), num(e.balance)])
    gl.push([txt('Total ' + a.name, true), null, null, null, null, null, num(a.debit, true), num(a.credit, true), num(a.balance, true)])
  }
  gl.push([], [txt('TOTAL', true), null, null, null, null, null, num(d.totals.debit, true), num(d.totals.credit, true), null])
  const data: Cell[][] = [
    ['Account code', 'Account', 'Group', 'Date', 'No.', 'Description', 'Project', 'Vendor / Client', 'Division', 'Debit', 'Credit'].map((h) => txt(h, true)),
    ...d.accounts.flatMap((a) =>
      a.entries.map((e) => [
        txt(a.code),
        txt(a.name),
        txt(GROUP_LABEL[a.group] ?? a.group),
        txt(e.date),
        txt(e.number),
        txt(e.description),
        txt(e.project),
        txt(e.party),
        txt(e.division),
        num(e.debit),
        num(e.credit),
      ]),
    ),
  ]
  const w = (n: number[]) => n.map((width) => ({ width }))
  await writeXlsxFile([gl, data], {
    sheets: ['Buku Besar', 'Data'],
    columns: [w([12, 18, 48, 14, 30, 16, 16, 16, 16]), w([12, 34, 18, 12, 18, 48, 14, 30, 16, 16, 16])],
    fileName: `Buku Besar ${d.company.code ?? 'SRI'} ${d.label}.xlsx`,
  })
}

function Ledger() {
  const d = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const [openAll, setOpenAll] = useState(false)
  return (
    <>
      <PageHeader
        title="Buku Besar"
        sub={`${d.company.name}. General ledger: every transaction by chart of accounts (COA), by invoice / bill date, with a running balance per account.`}
        right={
          <div className="flex items-center gap-3">
            <button className="btn-ghost" onClick={() => setOpenAll((v) => !v)}>
              {openAll ? 'Collapse all' : 'Expand all'}
            </button>
            <button className="btn" onClick={() => downloadXlsx(d).catch(ui.error)}>
              Download Excel
            </button>
          </div>
        }
      />
      <FilterBar value={pickFilters(search)} lists={d.ref} onChange={(f) => navigate({ search: (prev) => ({ ...prev, ...f }) })} />
      <p className="-mt-2 mb-4 text-[13px] text-muted">
        {d.label}. {d.accounts.length} accounts, {d.totals.entries} entries. Spend is a debit, income a credit; closing balances match the{' '}
        <Link to="/pnl" search={pickFilters(search)} className="text-accent">
          P&L
        </Link>
        . Payroll months come from Employee OpEx.
      </p>
      <div className="space-y-3" key={String(openAll)}>
        {d.accounts.map((a) => (
          <details key={a.key} open={openAll} className="card overflow-hidden">
            <summary className="flex cursor-pointer items-center gap-4 px-5 py-3 text-[13px] hover:bg-black/[0.015]">
              <span className="min-w-0 flex-1 truncate font-medium">{accLabel(a)}</span>
              <span className="hidden text-muted sm:inline">
                {GROUP_LABEL[a.group]} · {a.entries.length}
              </span>
              <span className={`w-36 text-right font-semibold tabular-nums ${a.code ? '' : 'text-warn'}`}>{rp(a.balance)}</span>
            </summary>
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full text-[12px]">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">No.</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 text-right font-medium">Debit</th>
                    <th className="px-3 py-2 text-right font-medium">Credit</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {a.entries.map((e, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{e.date}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{e.number ?? ''}</td>
                      <td className="px-3 py-1.5">
                        {e.description}
                        {e.party && <span className="text-muted"> · {e.party}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        {e.project ? (
                          <Link to="/projects/$code" params={{ code: e.project }} className="text-accent">
                            {e.project}
                          </Link>
                        ) : (
                          <span className="text-muted">{e.division ?? 'Company'}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{e.debit ? rp(e.debit) : ''}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{e.credit ? rp(e.credit) : ''}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{rp(e.balance)}</td>
                    </tr>
                  ))}
                  <tr className="bg-black/[0.03] font-semibold">
                    <td className="px-3 py-1.5" colSpan={4}>
                      Total
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{rp(a.debit)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{rp(a.credit)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{rp(a.balance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        ))}
        {d.accounts.length === 0 && <div className="card px-5 py-6 text-[13px] text-muted">No transactions in this view.</div>}
      </div>
    </>
  )
}
