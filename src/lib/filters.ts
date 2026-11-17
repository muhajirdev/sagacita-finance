/**
 * List filters kept in the URL (?year=2025&division=2&client=5&project=25ION08020).
 * Shared by the pages (search params) and the server functions (which filter in SQL).
 * No year/from/to means the current year; year=all means every year.
 */
import { z } from 'zod'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const filterSearch = z.object({
  year: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
  /** Part of the year: q1..q4 or m01..m12. Ignored with year=all or from/to. */
  period: z.string().regex(/^(q[1-4]|m(0[1-9]|1[0-2]))$/).optional(),
  from: date.optional(),
  to: date.optional(),
  division: z.coerce.number().int().optional(),
  client: z.coerce.number().int().optional(),
  project: z.string().optional(),
  status: z.enum(['draft', 'active', 'closed']).optional(),
})
export type FilterSearch = z.infer<typeof filterSearch>

/** What the SQL helpers take. */
export type ListFilter = {
  from?: string
  to?: string
  divisionId?: number
  clientId?: number
  projectCode?: string
  projectStatus?: 'draft' | 'active' | 'closed'
}

export const currentYear = () => new Date().getFullYear()

/** Date range a search stands for. from/to win over year. */
export function rangeOf(s: FilterSearch): { from?: string; to?: string } {
  if (s.from || s.to) return { from: s.from, to: s.to }
  if (s.year === 'all') return {}
  const y = s.year ?? currentYear()
  const [a, b] = s.period?.startsWith('q') ? [Number(s.period[1]) * 3 - 2, Number(s.period[1]) * 3] : s.period ? [Number(s.period.slice(1)), Number(s.period.slice(1))] : [1, 12]
  const pad = (n: number) => String(n).padStart(2, '0')
  const last = new Date(Date.UTC(y, b, 0)).getUTCDate()
  return { from: `${y}-${pad(a)}-01`, to: `${y}-${pad(b)}-${pad(last)}` }
}

export function toListFilter(s: FilterSearch): ListFilter {
  return {
    ...rangeOf(s),
    divisionId: s.division,
    clientId: s.client,
    projectCode: s.project || undefined,
    projectStatus: s.status,
  }
}

/** Only the filter keys of a page's search (so loaderDeps doesn't refetch on tab changes). */
export const pickFilters = (s: FilterSearch): FilterSearch => ({
  year: s.year,
  period: s.period,
  from: s.from,
  to: s.to,
  division: s.division,
  client: s.client,
  project: s.project,
  status: s.status,
})

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const PERIOD_OPTIONS = [
  { value: 'year', label: 'Full year' },
  ...[1, 2, 3, 4].map((q) => ({ value: `q${q}`, label: `Q${q}` })),
  ...MONTH_NAMES.map((m, i) => ({ value: `m${String(i + 1).padStart(2, '0')}`, label: m })),
]

/** Label for the selected range, e.g. "Q1 2025", "Mar 2025", "2025", "All years", "2025-01-05 to 2025-02-10". */
export function rangeLabel(s: FilterSearch): string {
  if (s.from || s.to) return `${s.from ?? '…'} to ${s.to ?? '…'}`
  if (s.year === 'all') return 'All years'
  const y = s.year ?? currentYear()
  return s.period ? `${PERIOD_OPTIONS.find((o) => o.value === s.period)?.label} ${y}` : String(y)
}
