import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { PageHeader, StatusPill, UsageBar } from '#/components/ui'
import { rp } from '#/lib/format'
import { createProjectFn, getProjects, getReference } from '#/server/fns'

export const Route = createFileRoute('/_app/projects/')({
  loader: async () => ({
    projects: await getProjects(),
    ref: await getReference(),
  }),
  component: Projects,
})

function Projects() {
  const { projects, ref } = Route.useLoaderData()
  const router = useRouter()
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(false)
  return (
    <>
      <PageHeader
        title="Projects"
        sub={`${projects.length} projects. Budget is the expense ceiling: max expense plus ASF.`}
        right={
          <button className="btn" onClick={() => setOpen(!open)}>
            {open ? 'Close' : 'New project'}
          </button>
        }
      />
      {open && (
        <form
          className="card mb-8 grid gap-3 p-5 md:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const f = new FormData(form)
            const s = (k: string) => String(f.get(k) ?? '')
            try {
              await createProjectFn({
                data: {
                  code: s('code'),
                  name: s('name'),
                  clientName: s('clientName'),
                  divisionId: Number(s('divisionId')),
                  type: s('type') as 'retainer' | 'project',
                  startDate: s('startDate') || undefined,
                  endDate: s('endDate') || undefined,
                },
              })
              form.reset()
              setMsg('Project created')
              await router.invalidate()
            } catch (err) {
              setMsg(err instanceof Error ? err.message : String(err))
            }
          }}
        >
          <input className="input" name="code" placeholder="Project number" required />
          <input className="input" name="name" placeholder="Project name" required />
          <input className="input" name="clientName" placeholder="Client" required />
          <select className="input" name="divisionId">
            {ref.divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select className="input" name="type">
            <option value="project">Project</option>
            <option value="retainer">Retainer</option>
          </select>
          <input className="input" name="startDate" type="date" />
          <input className="input" name="endDate" type="date" />
          <div className="flex items-center gap-3">
            <button className="btn">Create project</button>
            <span className="text-[13px] text-ink-2">{msg}</span>
          </div>
        </form>
      )}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Project</th>
              <th className="th">Client</th>
              <th className="th">Division</th>
              <th className="th">Type</th>
              <th className="th">Period</th>
              <th className="th num">Budget</th>
              <th className="th num">Spent</th>
              <th className="th">Used</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td className="td">
                  <Link to="/projects/$code" params={{ code: p.code }} className="font-medium hover:text-accent">
                    {p.name}
                  </Link>
                  <div className="text-[12px] text-muted">{p.code}</div>
                </td>
                <td className="td">{p.client}</td>
                <td className="td">{p.division}</td>
                <td className="td capitalize">{p.type}</td>
                <td className="td whitespace-nowrap text-[12px] text-muted">
                  {p.startDate} – {p.endDate}
                </td>
                <td className="td num">{rp(p.totals.ceiling)}</td>
                <td className="td num">{rp(p.totals.actual)}</td>
                <td className="td">
                  <UsageBar pct={p.totals.usedPct} />
                </td>
                <td className="td">
                  <StatusPill status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
