import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { TransactionForm, TransactionTable } from '#/components/transactions'
import { getReference, getTransactions } from '#/server/fns'

const search = z.object({ open: z.boolean().optional(), direction: z.enum(['in', 'out']).optional() })

export const Route = createFileRoute('/_app/transactions')({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => ({
    rows: await getTransactions({ data: { openOnly: deps.open, direction: deps.direction } }),
    ref: await getReference(),
  }),
  component: Transactions,
})

function Transactions() {
  const { rows, ref } = Route.useLoaderData()
  const s = Route.useSearch()
  const navigate = Route.useNavigate()
  const tab = (label: string, next: z.infer<typeof search>) => {
    const active = s.open === next.open && s.direction === next.direction
    return (
      <button
        key={label}
        className={`rounded-md px-3 py-1.5 text-sm ${active ? 'bg-stone-900 text-white' : 'hover:bg-stone-200'}`}
        onClick={() => navigate({ search: next })}
      >
        {label}
      </button>
    )
  }
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Company spend (no project)</h2>
        <TransactionForm companies={ref.companies} categories={ref.categories} />
        <p className="text-xs text-stone-500">Project spend and client invoices are recorded on the project page.</p>
      </section>
      <div className="flex flex-wrap gap-1">
        {tab('All', {})}
        {tab('Open', { open: true })}
        {tab('Money in', { direction: 'in' })}
        {tab('Money out', { direction: 'out' })}
      </div>
      <TransactionTable rows={rows} />
    </div>
  )
}
