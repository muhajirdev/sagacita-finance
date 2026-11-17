import { Select } from '#/components/dialogs'
import { currentYear, rangeOf, type FilterSearch } from '#/lib/filters'

type Ref = {
  divisions: { id: number; name: string }[]
  clients: { id: number; name: string }[]
  projects?: { id: number; code: string; name: string }[]
}

const ANY = 'any'

/**
 * Year / date range, division, client, project (and project status) filters.
 * Lives in the URL; the page's loader re-runs on change so the server only returns matching rows.
 */
export function FilterBar({
  value,
  onChange,
  lists: r,
  project = true,
  status = false,
}: {
  value: FilterSearch
  onChange: (next: FilterSearch) => void
  lists: Ref
  project?: boolean
  status?: boolean
}) {
  const custom = Boolean(value.from || value.to)
  const yearValue = custom ? 'custom' : String(value.year ?? currentYear())
  const years = Array.from({ length: currentYear() - 2023 + 1 }, (_, i) => String(currentYear() + 1 - i))
  const set = (patch: Partial<FilterSearch>) => onChange({ ...value, ...patch })
  const num = (v: string) => (v === ANY ? undefined : Number(v))
  const range = rangeOf(value)
  const dirty = value.year !== undefined || custom || value.division || value.client || value.project || value.status

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Select
        className="w-36"
        value={yearValue}
        onChange={(v) =>
          v === 'custom'
            ? set({ year: undefined, from: range.from ?? `${currentYear()}-01-01`, to: range.to ?? `${currentYear()}-12-31` })
            : set({ year: v === 'all' ? 'all' : Number(v), from: undefined, to: undefined })
        }
        options={[...years.map((y) => ({ value: y, label: y })), { value: 'all', label: 'All years' }, { value: 'custom', label: 'Date range…' }]}
      />
      {custom && (
        <>
          <input type="date" className="input w-40" value={value.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
          <span className="text-[13px] text-muted">to</span>
          <input type="date" className="input w-40" value={value.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
        </>
      )}
      <Select
        className="w-44"
        value={value.division ? String(value.division) : ANY}
        onChange={(v) => set({ division: num(v) })}
        options={[{ value: ANY, label: 'All divisions' }, ...r.divisions.map((d) => ({ value: String(d.id), label: d.name }))]}
      />
      <Select
        className="w-52"
        value={value.client ? String(value.client) : ANY}
        onChange={(v) => set({ client: num(v) })}
        options={[{ value: ANY, label: 'All clients' }, ...r.clients.map((c) => ({ value: String(c.id), label: c.name }))]}
      />
      {project && r.projects && (
        <Select
          className="w-56"
          value={value.project ?? ANY}
          onChange={(v) => set({ project: v === ANY ? undefined : v })}
          options={[{ value: ANY, label: 'All projects' }, ...r.projects.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` }))]}
        />
      )}
      {status && (
        <Select
          className="w-36"
          value={value.status ?? ANY}
          onChange={(v) => set({ status: v === ANY ? undefined : (v as FilterSearch['status']) })}
          options={[
            { value: ANY, label: 'Any status' },
            { value: 'draft', label: 'Draft' },
            { value: 'active', label: 'Active' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
      )}
      {dirty && (
        <button
          className="btn-ghost"
          onClick={() => onChange({ year: undefined, from: undefined, to: undefined, division: undefined, client: undefined, project: undefined, status: undefined })}
        >
          Reset
        </button>
      )}
    </div>
  )
}
