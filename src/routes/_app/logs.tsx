import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'

import { Select } from '#/components/dialogs'
import { PageHeader } from '#/components/ui'
import { getActivity } from '#/server/pages'

const search = z.object({
  entity: z.string().optional(),
  source: z.enum(['web', 'mcp', 'import']).optional(),
  actor: z.string().optional(),
  batch: z.string().optional(),
  before: z.number().int().optional(),
})

export const Route = createFileRoute('/_app/logs')({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    getActivity({ data: { entity: deps.entity, source: deps.source, actor: deps.actor, batchId: deps.batch, before: deps.before } }),
  component: Logs,
})

const ENTITIES = [
  'transactions',
  'payments',
  'projects',
  'budget_lines',
  'approvals',
  'parties',
  'opex_budgets',
  'payroll_months',
  'documents',
  'users',
]
const SOURCE_LABEL = { web: 'Web', mcp: 'WhatsApp / MCP', import: 'Import' } as const
const ALL = 'All'

const when = (at: string) =>
  new Date(at.replace(' ', 'T') + (at.endsWith('Z') ? '' : 'Z')).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

function Logs() {
  const rows = Route.useLoaderData()
  const s = Route.useSearch()
  const navigate = Route.useNavigate()
  const [actor, setActor] = useState(s.actor ?? '')
  const set = (next: Partial<z.infer<typeof search>>) => navigate({ search: { ...s, before: undefined, ...next } })
  return (
    <>
      <PageHeader title="Logs" sub="Every change made from the web app, WhatsApp / MCP and imports. Newest first." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          className="w-40 py-1"
          value={s.entity ?? ALL}
          options={[{ value: ALL, label: 'All records' }, ...ENTITIES.map((e) => ({ value: e, label: e }))]}
          onChange={(v) => set({ entity: v === ALL ? undefined : v })}
        />
        <Select
          className="w-40 py-1"
          value={s.source ?? ALL}
          options={[{ value: ALL, label: 'All sources' }, ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))]}
          onChange={(v) => set({ source: v === ALL ? undefined : (v as 'web' | 'mcp' | 'import') })}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            set({ actor: actor.trim() || undefined })
          }}
        >
          <input className="input w-56 py-1" placeholder="Who (email or name)" value={actor} onChange={(e) => setActor(e.target.value)} />
        </form>
        {s.batch && (
          <button className="btn-ghost" onClick={() => set({ batch: undefined })}>
            Import {s.batch} ✕
          </button>
        )}
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">When</th>
              <th className="th">Who</th>
              <th className="th">From</th>
              <th className="th">Action</th>
              <th className="th">What</th>
              <th className="th">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="td whitespace-nowrap text-ink-2">{when(r.at)}</td>
                <td className="td">{r.actor}</td>
                <td className="td whitespace-nowrap">
                  {SOURCE_LABEL[r.source]}
                  {r.batchId && (
                    <button className="block text-[12px] text-muted underline" onClick={() => set({ batch: r.batchId! })}>
                      {r.batchId}
                    </button>
                  )}
                </td>
                <td className="td font-medium">{r.action}</td>
                <td className="td whitespace-nowrap">
                  {r.entity} #{r.entityId}
                </td>
                <td className="td max-w-md">
                  {r.data && <code className="block break-all text-[12px] text-ink-2">{r.data}</code>}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="td text-muted" colSpan={6}>
                  Nothing logged yet for these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length === 100 && (
        <div className="mt-4 text-center">
          <button className="btn-ghost" onClick={() => navigate({ search: { ...s, before: rows[rows.length - 1].id } })}>
            Older →
          </button>
        </div>
      )}
    </>
  )
}
