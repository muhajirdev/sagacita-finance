import { createFileRoute, useRouter } from '@tanstack/react-router'

import { PageHeader } from '#/components/ui'
import { ui } from '#/components/dialogs'
import { FilterBar } from '#/components/filter-bar'
import { filterSearch, pickFilters } from '#/lib/filters'
import { getReference } from '#/server/fns'
import { rp } from '#/lib/format'
import { getBalanceSheet, setOpeningBalancesFn } from '#/server/pages'
import type { Cell } from 'write-excel-file'

export const Route = createFileRoute('/_app/balance-sheet')({
  validateSearch: filterSearch,
  loaderDeps: ({ search }) => pickFilters(search),
  loader: async ({ deps }) => {
    const [d, ref] = await Promise.all([getBalanceSheet({ data: deps }), getReference()])
    return { ...d, ref }
  },
  component: BalanceSheet,
})

type Data = Awaited<ReturnType<typeof getBalanceSheet>>
type Line = { key: string; label: string; amount: number }

const OPENING_FIELDS = [
  ['cash', 'Cash & bank (all accounts)'],
  ['receivables', 'Accounts receivable (unpaid invoices)'],
  ['otherAssets', 'Other assets (fixed assets, deposits, prepaid, ...)'],
  ['payables', 'Accounts payable (unpaid bills)'],
  ['taxPayable', 'Tax & BPJS payable'],
  ['otherLiabilities', 'Other liabilities (loans, accruals, ...)'],
  ['shareCapital', 'Share capital'],
  ['retainedEarnings', 'Retained earnings'],
] as const

const longDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

function Row({ label, value, strong, indent }: { label: string; value: number; strong?: boolean; indent?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 px-5 py-2 text-[13px] ${strong ? 'bg-black/[0.03] font-semibold' : ''}`}>
      <span className={indent ? 'pl-4 text-ink-2' : ''}>{label}</span>
      <span className={`tabular-nums ${value < 0 ? 'text-bad' : ''}`}>{rp(value)}</span>
    </div>
  )
}

async function downloadXlsx(d: Data) {
  const { default: writeXlsxFile } = await import('write-excel-file')
  const num = (v: number, bold = false): Cell => ({ value: Math.round(v), type: Number, format: '#,##0;(#,##0)', fontWeight: bold ? 'bold' : undefined })
  const txt = (v: string, bold = false): Cell => ({ value: v, fontWeight: bold ? 'bold' : undefined })
  const block = (title: string, lines: Line[], total: number): Cell[][] => [
    [],
    [txt(title, true)],
    ...lines.map((l) => [txt(l.label), num(l.amount)]),
    [txt(`TOTAL ${title}`, true), num(total, true)],
  ]
  const rows: Cell[][] = [
    [txt(d.company.name.toUpperCase(), true)],
    [txt(`STATEMENT OF FINANCIAL POSITION AS ${longDate(d.asOf).toUpperCase()}`, true)],
    ...block('ASSETS', d.assets, d.totals.assets),
    ...block('LIABILITIES', d.liabilities, d.totals.liabilities),
    ...block('EQUITY', d.equity, d.totals.equity),
    [],
    [txt('TOTAL LIABILITIES AND EQUITY', true), num(d.totals.liabilities + d.totals.equity, true)],
  ]
  if (d.totals.difference) rows.push([txt('Difference (not balanced)'), num(d.totals.difference)])
  await writeXlsxFile(rows, { sheet: 'BS', columns: [{ width: 60 }, { width: 22 }], fileName: `BS ${d.company.code ?? 'SRI'} ${d.asOf}.xlsx` })
}

function BalanceSheet() {
  const d = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const router = useRouter()
  const o = d.opening

  const editOpening = async () => {
    const v = await ui.prompt(
      'Opening balances',
      [
        { name: 'asOf', label: 'Opening date', type: 'date', defaultValue: o.asOf, required: true, hint: 'E.g. 31 Dec 2024. Everything the app recorded after this date is added on top.' },
        ...OPENING_FIELDS.map(([name, label]) => ({ name, label, type: 'number' as const, defaultValue: String(o[name]) })),
      ],
      { message: `${d.company.name}. Take these from the closing balance sheet on the opening date. Amounts in rupiah.` },
    )
    if (!v) return
    const ok = await ui.run(
      () =>
        setOpeningBalancesFn({
          data: {
            companyId: d.company.id,
            asOf: v.asOf,
            ...(Object.fromEntries(OPENING_FIELDS.map(([k]) => [k, Number(v[k] || 0)])) as Record<(typeof OPENING_FIELDS)[number][0], number>),
          },
        }),
      'Opening balances saved',
    )
    if (ok) router.invalidate()
  }

  const section = (title: string, lines: Line[], total: number) => (
    <div>
      <Row label={title} value={total} strong />
      {lines.map((l) => (
        <Row key={l.key} label={l.label} value={l.amount} indent />
      ))}
    </div>
  )

  return (
    <>
      <PageHeader
        title="Balance Sheet"
        sub={`${d.company.name}. As of ${longDate(d.asOf)} (end of the period picked, or today).`}
        right={
          <div className="flex items-center gap-3">
            <button className="btn-ghost" onClick={editOpening}>
              Opening balances
            </button>
            <button className="btn" onClick={() => downloadXlsx(d).catch(ui.error)}>
              Download Excel
            </button>
          </div>
        }
      />
      <FilterBar value={pickFilters(search)} lists={d.ref} onChange={(f) => navigate({ search: (prev) => ({ ...prev, ...f }) })} />
      <p className="-mt-2 mb-4 text-[13px] text-muted">
        Opening balances as of {longDate(o.asOf)}
        {o.updatedAt ? `, entered by ${o.updatedBy}` : ' (not entered yet, all 0)'}. Division, client and project filters don't apply here.
      </p>
      {!o.updatedAt && (
        <p className="mb-4 text-[13px] text-warn">Enter the opening balances first (button above), or cash and equity will be off.</p>
      )}
      {d.openingGap !== 0 && o.updatedAt && (
        <p className="mb-4 text-[13px] text-warn">The opening balances don't balance: assets minus liabilities and equity is {rp(d.openingGap)}.</p>
      )}
      <div className="card max-w-3xl divide-y divide-line overflow-hidden">
        {section('Assets', d.assets, d.totals.assets)}
        {section('Liabilities', d.liabilities, d.totals.liabilities)}
        {section('Equity', d.equity, d.totals.equity)}
        <Row label="Total liabilities and equity" value={d.totals.liabilities + d.totals.equity} strong />
        {d.totals.difference !== 0 && <Row label="Difference (not balanced)" value={d.totals.difference} strong />}
      </div>
      <p className="mt-4 max-w-3xl text-[12px] text-muted">
        Profit is the P&L for the same dates ({rp(d.notes.pnlNetProfit)}) plus {rp(d.notes.advancesWithoutLpj)} of cash advances that have no LPJ yet: the
        P&L counts an advance as cost, here it stays an asset until the LPJ. Payroll net salary ({rp(d.notes.payrollNetSalary)}) is taken as paid in its
        month; its PPh 21 and BPJS go to tax payable until deposited on the Tax page.
      </p>
    </>
  )
}
