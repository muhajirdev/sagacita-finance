import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { TransactionForm, TransactionTable } from '#/components/transactions'
import { PageHeader, Section } from '#/components/ui'
import { getReference, getTransactions } from '#/server/fns'

const search = z.object({
  open: z.boolean().optional(),
  direction: z.enum(['in', 'out']).optional(),
})

export const Route = createFileRoute('/_app/transactions')({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => ({
    rows: await getTransactions({
      data: { openOnly: deps.open, direction: deps.direction },
    }),
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
        className={`rounded-full px-3.5 py-1 text-[13px] font-medium transition ${active ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
        onClick={() => navigate({ search: next })}
      >
        {label}
      </button>
    )
  }
  return (
    <>
      <PageHeader title="Transactions" sub="Every invoice, bill, cash advance and reimbursement, from the web and WhatsApp." />
      <div className="space-y-10">
        <Section
          title="Activity"
          right={
            <div className="inline-flex rounded-full bg-black/[0.05] p-0.5">
              {tab('All', {})}
              {tab('Open', { open: true })}
              {tab('Money in', { direction: 'in' })}
              {tab('Money out', { direction: 'out' })}
            </div>
          }
        >
          <TransactionTable rows={rows} />
        </Section>
        <Section title="Record company spend">
          <p className="-mt-1 text-[13px] text-muted">
            For costs with no project, like rent or subscriptions. Project spend and client invoices go on the project page.
          </p>
          <TransactionForm companies={ref.companies} categories={ref.categories} />
        </Section>
      </div>
    </>
  )
}
