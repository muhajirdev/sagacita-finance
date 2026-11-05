import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'

import { HealthBadge, Modal, PageHeader, StatusPill, pct } from '#/components/ui'
import { rp } from '#/lib/format'
import { addBudgetLineFn, getProject, getProjects, submitBudgetFn } from '#/server/fns'
import { updateBudgetLineFn } from '#/server/pages'
import { Select, ui } from '#/components/dialogs'

export const Route = createFileRoute('/_app/budget')({
  validateSearch: z.object({ project: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => ({
    projects: await getProjects(),
    detail: deps.project ? await getProject({ data: { code: deps.project } }) : null,
  }),
  component: Budget,
})

type Line = { id: number; name: string; charge: number; maxExpense: number; asfAmount: number }

function Budget() {
  const { projects, detail } = Route.useLoaderData()
  const { project } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <>
      <PageHeader
        title="Budget Control"
        sub="SOW items per project: charge to the client, max expense, ASF, and actual spend against the ceiling."
        right={
          <Select
            className="w-auto max-w-[min(420px,100%)]"
            value={project ?? ''}
            onChange={(v) => navigate({ search: { project: v || undefined } })}
            options={[
              { value: '', label: 'All projects (overview)' },
              ...projects.map((p) => ({ value: p.code, label: `${p.code} — ${p.client} ${p.name}` })),
            ]}
          />
        }
      />
      {detail ? <Detail d={detail} /> : <Overview projects={projects} />}
    </>
  )
}

function Overview({ projects }: { projects: Awaited<ReturnType<typeof getProjects>> }) {
  const navigate = useNavigate()
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="th">Client</th>
            <th className="th">Project Name</th>
            <th className="th num">Allocated Exp</th>
            <th className="th num">Actual Spend</th>
            <th className="th num">Remaining</th>
            <th className="th num">% Used</th>
            <th className="th">Health</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="cursor-pointer" onClick={() => navigate({ to: '/budget', search: { project: p.code } })}>
              <td className="td font-medium">{p.client}</td>
              <td className="td">
                <Link to="/budget" search={{ project: p.code }} className="hover:text-accent">
                  {p.name}
                </Link>
              </td>
              <td className="td num">{rp(p.totals.ceiling)}</td>
              <td className="td num">{rp(p.totals.actual)}</td>
              <td className={`td num ${p.totals.remaining < 0 ? 'text-bad' : ''}`}>{rp(p.totals.remaining)}</td>
              <td className="td num">{pct(p.totals.usedPct)}</td>
              <td className="td">
                <HealthBadge used={p.totals.usedPct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Detail({ d }: { d: Awaited<ReturnType<typeof getProject>> }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Line | 'new' | null>(null)
  const { project, budget } = d
  const t = budget.totals
  const vat = (t.charge + t.asf) * 0.11
  return (
    <>
      <div className="card overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">
              {project.code} · {project.name}
            </div>
          </div>
          <StatusPill status={project.status} />
          {project.status === 'draft' && (
            <button
              className="btn-ghost py-1.5"
              onClick={async () => {
                try {
                  await submitBudgetFn({ data: { projectId: project.id } })
                  ui.toast('Budget sent for approval')
                } catch (e) {
                  ui.error(e)
                }
              }}
            >
              Ask for approval
            </button>
          )}
          <button className="btn" onClick={() => setEditing('new')}>
            + Add SOW item
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th className="th">SOW Item</th>
              <th className="th num">Charge</th>
              <th className="th num">Max Expense</th>
              <th className="th num">Alloc %</th>
              <th className="th num">Est Margin</th>
              <th className="th num">Actual Spend</th>
              <th className="th num">Remaining</th>
              <th className="th num">Actual Margin</th>
              <th className="th">Health</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {budget.lines.map((l) => (
              <tr key={l.id} className="cursor-pointer" onClick={() => setEditing(l)}>
                <td className="td whitespace-nowrap font-medium">
                  {l.name} {l.asfAmount > 0 && <span className="pill-neutral ml-1">ASF {rp(l.asfAmount)}</span>}
                </td>
                <td className="td num">{rp(l.charge)}</td>
                <td className="td num">{rp(l.maxExpense)}</td>
                <td className="td num">{pct(l.charge ? (l.ceiling / l.charge) * 100 : 0)}</td>
                <td className="td num">{rp(l.estMargin)}</td>
                <td className="td num">{rp(l.actual)}</td>
                <td className={`td num ${l.remaining < 0 ? 'text-bad' : ''}`}>{rp(l.remaining)}</td>
                <td className="td num">{rp(l.actualMargin)}</td>
                <td className="td">
                  <HealthBadge used={l.usedPct} />
                </td>
                <td className="td">
                  <button className="btn-ghost" onClick={() => setEditing(l)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {budget.lines.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={10}>
                  No SOW items yet. Add one above.
                </td>
              </tr>
            )}
          </tbody>
          {budget.lines.length > 0 && (
            <tfoot>
              <tr className="bg-canvas/60 font-semibold">
                <td className="td">TOTAL</td>
                <td className="td num">{rp(t.charge)}</td>
                <td className="td" />
                <td className="td" />
                <td className="td" />
                <td className="td num">{rp(t.actual)}</td>
                <td className="td num">{rp(t.remaining)}</td>
                <td className="td num">{rp(t.actualMargin)}</td>
                <td className="td" colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
        <div className="ml-auto max-w-sm space-y-1.5 border-t border-line px-5 py-4 text-[13px]">
          <Row label="Subtotal" value={rp(t.charge)} />
          {t.asf > 0 && <Row label={`ASF (${pct(t.charge ? (t.asf / t.charge) * 100 : 0)})`} value={rp(t.asf)} />}
          <Row label="VAT 11%" value={rp(vat)} />
          <div className="flex justify-between border-t border-line pt-2 text-[14px] font-semibold">
            <span>Grand total + tax</span>
            <span className="tabular-nums">{rp(t.charge + t.asf + vat)}</span>
          </div>
        </div>
      </div>
      {t.unbudgeted > 0 && (
        <p className="mt-3 text-[12px] text-warn">Rp {t.unbudgeted.toLocaleString('id-ID')} of spend is not on any SOW item.</p>
      )}
      {editing && (
        <SowForm
          projectId={project.id}
          line={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await router.invalidate()
          }}
        />
      )}
    </>
  )
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between text-ink-2">
    <span>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
)

function SowForm({
  projectId,
  line,
  onClose,
  onSaved,
}: {
  projectId: number
  line: Line | null
  onClose: () => void
  onSaved: () => void
}) {
  const [charge, setCharge] = useState(line?.charge ?? 0)
  const [asf, setAsf] = useState(line?.asfAmount ?? 0)
  const [err, setErr] = useState('')
  return (
    <Modal title={line ? 'Edit SOW item' : 'Add SOW item'} onClose={onClose}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const data = {
            name: String(f.get('name')),
            charge: Number(f.get('charge') || 0),
            maxExpense: Number(f.get('maxExpense') || 0),
            asfAmount: Number(f.get('asfAmount') || 0),
          }
          try {
            if (line) {
              const r = await updateBudgetLineFn({ data: { id: line.id, ...data } })
              if ('warning' in r && r.warning) ui.toast(r.warning, 'warn')
            } else await addBudgetLineFn({ data: { projectId, ...data } })
            onSaved()
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
          }
        }}
      >
        <label className="field sm:col-span-2">
          SOW item name
          <input className="input" name="name" defaultValue={line?.name} placeholder="e.g. Media Relations Retainer" required />
        </label>
        <label className="field">
          Charge (IDR)
          <input
            className="input"
            name="charge"
            type="number"
            defaultValue={line?.charge}
            onChange={(e) => setCharge(Number(e.target.value))}
            required
          />
        </label>
        <label className="field">
          Max expense (IDR)
          <input className="input" name="maxExpense" type="number" defaultValue={line?.maxExpense} required />
        </label>
        <label className="field">
          ASF amount (IDR), optional
          <input
            className="input"
            name="asfAmount"
            type="number"
            defaultValue={line?.asfAmount || ''}
            onChange={(e) => setAsf(Number(e.target.value))}
          />
        </label>
        <div className="field">
          ASF %<div className="input bg-canvas text-muted">{charge && asf ? pct((asf / charge) * 100) : '—'}</div>
        </div>
        {err && <p className="text-[13px] text-bad sm:col-span-2">{err}</p>}
        <div className="flex gap-2 sm:col-span-2">
          {line && (
            <button
              type="button"
              className="btn-ghost py-2 text-bad"
              onClick={async () => {
                if (!(await ui.confirm('Delete this SOW item?', { confirmLabel: 'Delete', danger: true }))) return
                try {
                  await updateBudgetLineFn({ data: { id: line.id, delete: true } })
                  onSaved()
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              Delete
            </button>
          )}
          <div className="flex-1" />
          <button type="button" className="btn-ghost py-2" onClick={onClose}>
            Cancel
          </button>
          <button className="btn">Save</button>
        </div>
      </form>
    </Modal>
  )
}
