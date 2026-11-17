import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'

import { PageHeader, Section, UsageBar } from '#/components/ui'
import { KIND_LABEL, rp, rpShort } from '#/lib/format'
import { getDashboard, getReference } from '#/server/fns'
import { FilterBar } from '#/components/filter-bar'
import { filterSearch, pickFilters } from '#/lib/filters'

export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    // Dashboard (Reporting) is owner-only; everyone else lands on their first section.
    if (context.user.role === 'hr') throw redirect({ to: '/employees' })
    if (context.user.role !== 'owner') throw redirect({ to: '/budget' })
  },
  validateSearch: filterSearch,
  loaderDeps: ({ search }) => pickFilters(search),
  loader: async ({ deps }) => {
    const [d, ref] = await Promise.all([getDashboard({ data: deps }), getReference()])
    return { ...d, ref }
  },
  component: Dashboard,
})

function Kpi({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="card p-5">
      <div className="eyebrow">{label}</div>
      <div
        className={`mt-2 text-[26px] font-semibold tracking-[-0.02em] tabular-nums ${tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : ''}`}
        title={rp(value)}
      >
        {rpShort(value)}
      </div>
      <div className="mt-0.5 text-[12px] text-muted">{sub}</div>
    </div>
  )
}

const fmtDate = (d: string | null) =>
  d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      })
    : '—'

function Dashboard() {
  const d = Route.useLoaderData()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const go = Route.useNavigate()
  const active = d.projects.filter((p) => p.status !== 'closed')
  const watch = [...d.projects].sort((a, b) => b.totals.usedPct - a.totals.usedPct).slice(0, 6)
  const over = d.projects.filter((p) => p.totals.usedPct > 100).length
  const today = new Date(d.today + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <>
      <PageHeader
        eyebrow={today}
        title="Overview"
        sub={`${active.length} active projects in this view. B = billion (miliar), M = million (juta).`}
      />
      <FilterBar value={pickFilters(search)} lists={d.ref} onChange={(f) => go({ search: (prev) => ({ ...prev, ...f }) })} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Billed" value={d.billing} sub="client invoices, before PPN" />
        <Kpi label="Collected" value={d.collected} sub="received from clients" />
        <Kpi
          label="Overdue from clients"
          value={d.overdue.amount}
          sub={`${d.overdue.count} invoices past due`}
          tone={d.overdue.count ? 'bad' : undefined}
        />
        <Kpi
          label="To pay by Friday"
          value={d.payables.amount}
          sub={`${d.payables.count} approved bills`}
          tone={d.payables.count ? 'warn' : undefined}
        />
      </div>

      {d.byDivision.length > 0 && (
        <div className="mt-10">
          <Section title="By division">
            <div className="card overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[12px] text-muted">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Division</th>
                    <th className="px-5 py-2.5 text-right font-medium">Billed</th>
                    <th className="px-5 py-2.5 text-right font-medium">Spent</th>
                    <th className="px-5 py-2.5 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.byDivision.map((r) => {
                    const margin = r.billed - r.spent
                    const picked = search.division === r.id
                    return (
                      <tr
                        key={r.name}
                        className={`transition ${r.id ? 'cursor-pointer hover:bg-black/[0.015]' : ''} ${picked ? 'bg-black/[0.03] font-medium' : ''}`}
                        onClick={() => r.id && go({ search: (prev) => ({ ...prev, division: picked ? undefined : r.id! }) })}
                      >
                        <td className="px-5 py-2.5">{r.name}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums" title={rp(r.billed)}>{rpShort(r.billed)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums" title={rp(r.spent)}>{rpShort(r.spent)}</td>
                        <td className={`px-5 py-2.5 text-right tabular-nums ${margin < 0 ? 'text-bad' : ''}`} title={rp(margin)}>
                          {rpShort(margin)}
                          {r.billed > 0 && <span className="ml-1.5 text-[12px] text-muted">{Math.round((margin / r.billed) * 100)}%</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[12px] text-muted">Billed and spent before tax, by invoice / bill date. Payroll is not included. Click a division to filter the dashboard.</p>
          </Section>
        </div>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Section
            title="Budget health"
            right={
              <Link to="/projects" className="text-[13px] font-medium text-accent">
                All projects
              </Link>
            }
          >
            <div className="card divide-y divide-line">
              {watch.map((p) => (
                <Link
                  key={p.id}
                  to="/projects/$code"
                  params={{ code: p.code }}
                  className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-black/[0.015]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{p.name}</div>
                    <div className="text-[12px] text-muted">
                      {p.client} · {p.division}
                    </div>
                  </div>
                  <div className="hidden text-right text-[12px] tabular-nums text-muted sm:block">
                    {rpShort(p.totals.actual)} of {rpShort(p.totals.ceiling)}
                  </div>
                  <UsageBar pct={p.totals.usedPct} />
                </Link>
              ))}
              {watch.length === 0 && <div className="px-5 py-6 text-[13px] text-muted">No active projects yet.</div>}
            </div>
            {over > 0 && <p className="text-[12px] text-bad">{over} project(s) are over their expense ceiling.</p>}
          </Section>
        </div>

        <div className="space-y-10 lg:col-span-2">
          <Section
            title="Due this week"
            right={
              <Link to="/payables" search={{ dueBy: d.weekEnd }} className="text-[13px] font-medium text-accent">
                Payment run
              </Link>
            }
          >
            <div className="card divide-y divide-line">
              {d.payables.items.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{t.party ?? t.category ?? KIND_LABEL[t.kind]}</div>
                    <div className="truncate text-[12px] text-muted">
                      {t.project_code ?? 'Company'} · due {fmtDate(t.due_date)}
                    </div>
                  </div>
                  <div className="text-[13px] font-medium tabular-nums">{rp(t.outstanding)}</div>
                </div>
              ))}
              {d.payables.count === 0 && <div className="px-5 py-6 text-[13px] text-muted">Nothing due this week.</div>}
            </div>
          </Section>

          <Section
            title="Overdue from clients"
            right={
              <Link to="/transactions" search={{ direction: 'in', open: true }} className="text-[13px] font-medium text-accent">
                All invoices
              </Link>
            }
          >
            <div className="card divide-y divide-line">
              {d.overdue.items.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{t.client}</div>
                    <div className="truncate text-[12px] text-muted">
                      {t.number} · due {fmtDate(t.due_date)}
                    </div>
                  </div>
                  <div className="text-[13px] font-medium tabular-nums text-bad">{rp(t.outstanding)}</div>
                </div>
              ))}
              {d.overdue.count === 0 && <div className="px-5 py-6 text-[13px] text-muted">No overdue invoices.</div>}
            </div>
          </Section>

          <Section
            title={`LPJ overdue (${d.lpjOverdue.count})`}
            right={
              <Link to="/expenses" search={{ tab: 'paid' }} className="text-[13px] font-medium text-accent">
                Cash advances
              </Link>
            }
          >
            <div className="card divide-y divide-line">
              {d.lpjOverdue.items.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{t.party ?? t.requested_by ?? 'Cash advance'}</div>
                    <div className="truncate text-[12px] text-muted">
                      {t.number ?? t.description} · LPJ due {fmtDate(t.lpj_due)}
                    </div>
                  </div>
                  <div className="text-[13px] font-medium tabular-nums text-bad">{rp(t.total)}</div>
                </div>
              ))}
              {d.lpjOverdue.count === 0 && <div className="px-5 py-6 text-[13px] text-muted">Every paid advance has its LPJ in.</div>}
            </div>
          </Section>
        </div>
      </div>

      <div className="mt-10">
        <Section
          title="Recent activity"
          right={
            <Link to="/transactions" className="text-[13px] font-medium text-accent">
              All transactions
            </Link>
          }
        >
          <div className="card overflow-x-auto">
            <table className="table">
              <tbody>
                {d.recent.map((t) => (
                  <tr
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => t.project_code && navigate({ to: '/projects/$code', params: { code: t.project_code } })}
                  >
                    <td className="td w-20 text-[12px] text-muted">{fmtDate(t.issue_date)}</td>
                    <td className="td">
                      <div className="font-medium">{t.party ?? t.client ?? t.category ?? '—'}</div>
                      <div className="text-[12px] text-muted">{t.description}</div>
                    </td>
                    <td className="td hidden text-[12px] text-muted sm:table-cell">{t.project_code ?? 'Company'}</td>
                    <td className={`td num font-medium ${t.direction === 'in' ? 'text-good' : ''}`}>
                      {t.direction === 'in' ? '+' : '−'}
                      {rp(t.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  )
}
