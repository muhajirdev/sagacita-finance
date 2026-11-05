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

export function HealthBadge({ used }: { used: number }) {
  if (used > 100) return <span className="pill-bad">Overspent</span>
  if (used >= 85) return <span className="pill-warn">At risk</span>
  return <span className="pill-good">Healthy</span>
}

export function TypeBadge({ type }: { type: string }) {
  return <span className={type === 'retainer' ? 'pill-warn' : 'pill-neutral'}>{type === 'retainer' ? 'Retainer' : 'Project'}</span>
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'accent' | 'bad' | 'good' }) {
  const color = tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : tone === 'accent' ? 'text-accent' : ''
  return (
    <div className="card p-5">
      <div className="eyebrow">{label}</div>
      <div className={`mt-2 text-[24px] font-semibold tracking-[-0.02em] tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly (T | readonly [T, string])[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex flex-wrap rounded-full bg-black/[0.05] p-0.5">
      {options.map((o) => {
        const [v, label] = Array.isArray(o) ? o : [o, o]
        return (
          <button
            key={v}
            className={`rounded-full px-3.5 py-1 text-[13px] font-medium transition ${value === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
            onClick={() => onChange(v)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** A centred sheet for create / edit forms. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/25 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[17px] font-semibold">{title}</h3>
          <button className="text-[20px] leading-none text-muted hover:text-ink" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const fdate = (d: string | null | undefined) =>
  d
    ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'
export const pct = (n: number) => `${(Number(n) || 0).toFixed(1)}%`
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
