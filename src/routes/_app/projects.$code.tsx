import { createFileRoute, useRouter } from '@tanstack/react-router'

import { TransactionForm, TransactionTable } from '#/components/transactions'
import { rp } from '#/lib/format'
import { addBudgetLineFn, getProject } from '#/server/fns'

export const Route = createFileRoute('/_app/projects/$code')({
  loader: ({ params }) => getProject({ data: { code: params.code } }),
  component: ProjectPage,
})

function ProjectPage() {
  const { project, budget, transactions } = Route.useLoaderData()
  const router = useRouter()
  const t = budget.totals
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{project.code}</h1>
        <p className="text-stone-500">{project.name}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Budget control</h2>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Line</th>
                <th className="th num">Charge</th>
                <th className="th num">Max expense</th>
                <th className="th num">ASF</th>
                <th className="th num">Ceiling</th>
                <th className="th num">Spent</th>
                <th className="th num">Remaining</th>
                <th className="th num">Used</th>
                <th className="th num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {budget.lines.map((l) => (
                <tr key={l.id}>
                  <td className="td">{l.name}</td>
                  <td className="td num">{rp(l.charge)}</td>
                  <td className="td num">{rp(l.maxExpense)}</td>
                  <td className="td num">{rp(l.asfAmount)}</td>
                  <td className="td num">{rp(l.ceiling)}</td>
                  <td className="td num">{rp(l.actual)}</td>
                  <td className="td num">{rp(l.remaining)}</td>
                  <td className={`td num ${l.usedPct > 100 ? 'font-semibold text-red-700' : ''}`}>{l.usedPct}%</td>
                  <td className="td num">{rp(l.actualMargin)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="td">Total</td>
                <td className="td num">{rp(t.charge)}</td>
                <td className="td" />
                <td className="td num">{rp(t.asf)}</td>
                <td className="td num">{rp(t.ceiling)}</td>
                <td className="td num">{rp(t.actual)}</td>
                <td className="td num">{rp(t.remaining)}</td>
                <td className="td num">{t.usedPct}%</td>
                <td className="td num">{rp(t.actualMargin)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const f = new FormData(form)
            await addBudgetLineFn({
              data: {
                projectId: project.id,
                name: String(f.get('name')),
                charge: Number(f.get('charge')),
                maxExpense: Number(f.get('maxExpense')),
                asfAmount: Number(f.get('asfAmount') || 0),
              },
            })
            form.reset()
            await router.invalidate()
          }}
        >
          <input className="input max-w-48" name="name" placeholder="New line, e.g. Produksi" required />
          <input className="input max-w-36" name="charge" type="number" placeholder="Charge" required />
          <input className="input max-w-36" name="maxExpense" type="number" placeholder="Max expense" required />
          <input className="input max-w-32" name="asfAmount" type="number" placeholder="ASF" />
          <button className="btn">Add line</button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Record</h2>
        <TransactionForm projectId={project.id} lines={budget.lines} />
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Transactions</h2>
        <TransactionTable rows={transactions} showProject={false} />
      </section>
    </div>
  )
}
