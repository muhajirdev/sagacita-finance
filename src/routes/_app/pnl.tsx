import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { PageHeader } from '#/components/ui'
import { ui } from '#/components/dialogs'
import { FilterBar } from '#/components/filter-bar'
import { filterSearch, pickFilters, rangeLabel } from '#/lib/filters'
import { getReference } from '#/server/fns'
import { rp } from '#/lib/format'
import { getPnl } from '#/server/pages'
import type { Cell } from 'write-excel-file'

export const Route = createFileRoute('/_app/pnl')({
  validateSearch: filterSearch,
  loaderDeps: ({ search }) => pickFilters(search),
  loader: async ({ deps }) => {
    const [d, ref] = await Promise.all([getPnl({ data: deps }), getReference()])
    return { ...d, ref, label: rangeLabel(deps) }
  },
  component: Pnl,
})

const SECTIONS = [
  ['revenue', 'Revenue'],
  ['cost_of_service', 'Cost of Service'],
  ['operating_expense', 'Operating Expenses'],
  ['other_income', 'Other Income'],
  ['other_expense', 'Other Expenses'],
  ['income_tax', 'PPh Final PP 55'],
] as const

function Row({ label, value, strong, indent }: { label: string; value: number; strong?: boolean; indent?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 px-5 py-2 text-[13px] ${strong ? 'bg-black/[0.03] font-semibold' : ''}`}>
      <span className={indent ? 'pl-4 text-ink-2' : ''}>{label}</span>
      <span className={`tabular-nums ${value < 0 ? 'text-bad' : ''}`}>{rp(value)}</span>
    </div>
  )
}

type PnlData = Awaited<ReturnType<typeof getPnl>>

/** Excel download laid out like the client's statement-of-financial file: a "PL" summary sheet and a "Notes PL" sheet by account. */
async function downloadXlsx(d: PnlData & { label: string }) {
  const { default: writeXlsxFile } = await import('write-excel-file')
  const t = d.totals
  const now = new Date()
  const end = d.to && d.to < now.toISOString().slice(0, 10) ? new Date(d.to + 'T00:00:00') : now
  const asOf = end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()
  const num = (v: number, bold = false): Cell => ({
    value: Math.round(v),
    type: Number,
    format: '#,##0;(#,##0)',
    fontWeight: bold ? 'bold' : undefined,
  })
  const txt = (v: string, bold = false): Cell => ({ value: v, fontWeight: bold ? 'bold' : undefined })
  const head = (title: string): Cell[][] => [
    [txt(d.company.name.toUpperCase(), true)],
    [txt(`${title} AS ${asOf}`, true)],
    [null, txt(d.label, true)],
  ]
  const pl: Cell[][] = [
    ...head('STATEMENTS OF PROFIT OR LOSS'),
    [txt('Revenue'), num(t.revenue)],
    [txt('Cost Of Service'), num(t.costOfService)],
    [txt('Gross Profit', true), num(t.grossProfit, true)],
    [txt('Operating Expenses'), num(t.operatingExpenses)],
    [txt('Operating Profit', true), num(t.operatingProfit, true)],
    [txt('Other Income ( expenses )'), num(t.other)],
    [txt('Profit Before Income Tax', true), num(t.beforeTax, true)],
    [txt('PPh Final PP 55'), num(t.incomeTax)],
    [txt('Net Profit', true), num(t.netProfit, true)],
  ]
  const notes: Cell[][] = [...head('NOTES TO FINANCIAL STATEMENTS')]
  const block = (title: string, groups: string[], totalLabel: string, sign: (g: string) => number = () => 1) => {
    const lines = d.lines.filter((l) => groups.includes(l.group))
    notes.push([], [txt(title, true), txt(d.label, true)])
    for (const l of lines) notes.push([txt(l.name), num(l.amount * sign(l.group))])
    notes.push([
      txt(totalLabel, true),
      num(
        lines.reduce((a, l) => a + l.amount * sign(l.group), 0),
        true,
      ),
    ])
  }
  block('SERVICE REVENUE', ['revenue'], 'TOTAL SERVICE REVENUE')
  block('COST OF REVENUE', ['cost_of_service'], 'TOTAL COST OF REVENUE')
  block('OPERATING EXPENSE', ['operating_expense'], 'TOTAL OPERATING EXPENSES')
  block('OTHER INCOME (EXPENSE)', ['other_income', 'other_expense'], 'TOTAL OTHER INCOME (EXPENSES)', (g) =>
    g === 'other_expense' ? -1 : 1,
  )
  block('INCOME TAX', ['income_tax'], 'TOTAL INCOME TAX')
  const cols = [{ width: 60 }, { width: 22 }]
  await writeXlsxFile([pl, notes], {
    sheets: ['PL', 'Notes PL'],
    columns: [cols, cols],
    fileName: `PL ${d.company.code ?? 'SRI'} ${d.label}.xlsx`,
  })
}

function Pnl() {
  const d = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const t = d.totals
  const total: Record<string, [string, number][]> = {
    cost_of_service: [['Gross Profit', t.grossProfit]],
    operating_expense: [['Operating Profit', t.operatingProfit]],
    other_expense: [['Profit Before Income Tax', t.beforeTax]],
    income_tax: [['Net Profit', t.netProfit]],
  }
  return (
    <>
      <PageHeader
        title="Profit & Loss"
        sub={`${d.company.name}. Grouped by chart of accounts (COA), by invoice / bill date. Payroll comes from Employee OpEx.`}
        right={
          <div className="flex items-center gap-3">
            <button className="btn" onClick={() => downloadXlsx(d).catch(ui.error)}>
              Download Excel
            </button>
          </div>
        }
      />
      <FilterBar value={pickFilters(search)} lists={d.ref} onChange={(f) => navigate({ search: (prev) => ({ ...prev, ...f }) })} />
      <p className="-mt-2 mb-4 text-[13px] text-muted">
        {d.label}. Payroll is included unless a client or project is picked (it isn't tied to projects).
      </p>
      {d.uncategorised !== 0 && (
        <p className="mb-4 text-[13px] text-warn">
          {rp(d.uncategorised)} has no COA yet ("Not categorised"). Pick the COA on the Expenses page to complete the statement.
        </p>
      )}
      <div className="card max-w-3xl divide-y divide-line overflow-hidden">
        {SECTIONS.map(([g, label]) => {
          const lines = d.lines.filter((l) => l.group === g)
          const sum = lines.reduce((a, l) => a + l.amount, 0)
          return (
            <div key={g}>
              <Row label={label} value={sum} strong />
              {lines.map((l) => (
                <Row key={(l.code ?? '') + l.name} label={`${l.code ? l.code + '  ' : ''}${l.name}`} value={l.amount} indent />
              ))}
              {(total[g] ?? []).map(([k, v]) => (
                <Row key={k} label={k} value={v} strong />
              ))}
            </div>
          )
        })}
      </div>
    </>
  )
}
