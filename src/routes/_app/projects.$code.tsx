import { Link, createFileRoute, useRouter } from '@tanstack/react-router'

import { TransactionForm, TransactionTable } from '#/components/transactions'
import { PageHeader, Section, StatusPill, UsageBar } from '#/components/ui'
import { rp, rpShort } from '#/lib/format'
import { addBudgetLineFn, getProject, submitBudgetFn } from '#/server/fns'
import { ui } from '#/components/dialogs'

export const Route = createFileRoute('/_app/projects/$code')({
  loader: ({ params }) => getProject({ data: { code: params.code } }),
  component: ProjectPage,
})

function ProjectPage() {
  const { project, budget, transactions } = Route.useLoaderData()
  const router = useRouter()
  const t = budget.totals
  const kpis = [
    { label: 'Charge to client', value: t.charge },
    { label: 'Budget (ceiling)', value: t.ceiling },
    { label: 'Spent', value: t.actual },
    { label: 'Margin so far', value: t.actualMargin },
  ]
  return (
    <>
      <Link to="/projects" className="mb-3 inline-block text-[13px] font-medium text-accent">
        ‹ Projects
      </Link>
      <PageHeader
        eyebrow={project.code}
        title={project.name}
        right={
          <div className="flex items-center gap-3">
            <StatusPill status={project.status} />
            {project.status === 'draft' && (
              <button
                className="btn"
                onClick={async () => {
                  try {
                    await submitBudgetFn({ data: { projectId: project.id } })
                    ui.toast('Sent for approval')
                    await router.invalidate()
                  } catch (e) {
                    ui.error(e)
                  }
                }}
              >
                Ask for budget approval
              </button>
            )}
          </div>
        }
      />
      <div className="mb-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card p-5">
            <div className="eyebrow">{k.label}</div>
            <div className="mt-2 text-[22px] font-semibold tracking-[-0.02em] tabular-nums" title={rp(k.value)}>
              {rpShort(k.value)}
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-10">
        <Section title="Budget control" right={<UsageBar pct={t.usedPct} />}>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">Line</th>
                  <th className="th num">Charge</th>
                  <th className="th num">Max expense</th>
                  <th className="th num">ASF</th>
                  <th className="th num">Ceiling</th>
                  <th className="th num">Spent</th>
                  <th className="th num">Remaining</th>
                  <th className="th">Used</th>
                  <th className="th num">Margin</th>
                </tr>
              </thead>
              <tbody>
                {budget.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="td whitespace-nowrap font-medium">{l.name}</td>
                    <td className="td num">{rp(l.charge)}</td>
                    <td className="td num">{rp(l.maxExpense)}</td>
                    <td className="td num">{rp(l.asfAmount)}</td>
                    <td className="td num">{rp(l.ceiling)}</td>
                    <td className="td num">{rp(l.actual)}</td>
                    <td className="td num">{rp(l.remaining)}</td>
                    <td className="td">
                      <UsageBar pct={l.usedPct} />
                    </td>
                    <td className="td num">{rp(l.actualMargin)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-canvas/60 font-semibold">
                  <td className="td">Total</td>
                  <td className="td num">{rp(t.charge)}</td>
                  <td className="td" />
                  <td className="td num">{rp(t.asf)}</td>
                  <td className="td num">{rp(t.ceiling)}</td>
                  <td className="td num">{rp(t.actual)}</td>
                  <td className="td num">{rp(t.remaining)}</td>
                  <td className="td">
                    <UsageBar pct={t.usedPct} />
                  </td>
                  <td className="td num">{rp(t.actualMargin)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <form
            className="flex flex-wrap items-center gap-2 pt-1"
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
            <button className="btn-ghost py-2">Add line</button>
          </form>
        </Section>

        <Section title="Transactions">
          <TransactionTable rows={transactions} showProject={false} />
        </Section>

        <Section title="Record an invoice or expense">
          <TransactionForm projectId={project.id} lines={budget.lines} />
        </Section>
      </div>
    </>
  )
}
