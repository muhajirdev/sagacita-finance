import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { rp } from '#/lib/format'
import { createProjectFn, getProjects, getReference } from '#/server/fns'

export const Route = createFileRoute('/_app/projects/')({
  loader: async () => ({ projects: await getProjects(), ref: await getReference() }),
  component: Projects,
})

function Projects() {
  const { projects, ref } = Route.useLoaderData()
  const router = useRouter()
  const [msg, setMsg] = useState('')
  return (
    <div className="space-y-6">
      <form
        className="card grid gap-3 p-4 md:grid-cols-4"
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
          <button className="btn">New project</button>
          <span className="text-sm text-stone-600">{msg}</span>
        </div>
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Project</th>
              <th className="th">Client</th>
              <th className="th">Division</th>
              <th className="th">Type</th>
              <th className="th">Period</th>
              <th className="th num">Ceiling</th>
              <th className="th num">Spent</th>
              <th className="th num">Used</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td className="td">
                  <Link to="/projects/$code" params={{ code: p.code }} className="font-medium text-brand">
                    {p.code}
                  </Link>
                  <div className="text-xs text-stone-500">{p.name}</div>
                </td>
                <td className="td">{p.client}</td>
                <td className="td">{p.division}</td>
                <td className="td">{p.type}</td>
                <td className="td text-xs">
                  {p.startDate} → {p.endDate}
                </td>
                <td className="td num">{rp(p.totals.ceiling)}</td>
                <td className="td num">{rp(p.totals.actual)}</td>
                <td className={`td num ${p.totals.usedPct > 100 ? 'font-semibold text-red-700' : ''}`}>{p.totals.usedPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
