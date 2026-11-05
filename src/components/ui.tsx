import type { ReactNode } from 'react'

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="mt-1 text-[14px] text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

/** Budget usage: green under 85%, amber to 100%, red over. */
export function UsageBar({ pct }: { pct: number }) {
  const color = pct > 100 ? 'bg-bad' : pct >= 85 ? 'bg-warn' : 'bg-good'
  return (
    <div className="flex items-center gap-2">
      <div className="bar w-20">
        <span className={color} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`w-10 text-right text-[12px] tabular-nums ${pct > 100 ? 'font-semibold text-bad' : 'text-ink-2'}`}>{pct}%</span>
    </div>
  )
}

const STATUS: Record<string, string> = {
  draft: 'pill-neutral',
  approved: 'pill-good',
  settled: 'pill-neutral',
  void: 'pill-neutral',
  active: 'pill-good',
  closed: 'pill-neutral',
}
export function StatusPill({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue) return <span className="pill-bad">Overdue</span>
  return <span className={STATUS[status] ?? 'pill-neutral'}>{status[0].toUpperCase() + status.slice(1)}</span>
}
