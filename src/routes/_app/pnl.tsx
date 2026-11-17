import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { PageHeader } from '#/components/ui'
import { Select } from '#/components/dialogs'
import { rp } from '#/lib/format'
import { getPnl } from '#/server/pages'

export const Route = createFileRoute('/_app/pnl')({
  validateSearch: z.object({ year: z.coerce.number().int().optional() }),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: ({ deps }) => getPnl({ data: { year: deps.year } }),
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

function Pnl() {
  const d = Route.useLoaderData()
  const navigate = Route.useNavigate()
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
          <div className="w-28">
            <Select
              value={String(d.year)}
              onChange={(v) => navigate({ search: { year: Number(v) } })}
              options={d.years.map((y) => ({
                value: String(y),
                label: String(y),
              }))}
            />
          </div>
        }
      />
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
