import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { PageHeader, Section, UsageBar } from '#/components/ui'
import { KIND_LABEL, rp, rpShort } from '#/lib/format'
import { getDashboard } from '#/server/fns'

export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    if (context.user.role === 'admin') throw redirect({ to: '/budget' })
    if (context.user.role === 'hr') throw redirect({ to: '/empopex' })
  },
  loader: () => getDashboard(),
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
      <PageHeader eyebrow={today} title="Overview" sub={`${active.length} active projects across all divisions. M = miliar, jt = juta.`} />

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
                  <tr key={t.id}>
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
