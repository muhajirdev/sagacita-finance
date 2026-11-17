/**
 * List filters kept in the URL (?year=2025&division=2&client=5&project=25ION08020).
 * Shared by the pages (search params) and the server functions (which filter in SQL).
 * No year/from/to means the current year; year=all means every year.
 */
import { z } from 'zod'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const filterSearch = z.object({
  year: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
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
  return { from: `${y}-01-01`, to: `${y}-12-31` }
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
  from: s.from,
  to: s.to,
  division: s.division,
  client: s.client,
  project: s.project,
  status: s.status,
})
