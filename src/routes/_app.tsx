import { Link, Outlet, createFileRoute, redirect, useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import {
  IconBuilding,
  IconCalendar,
  IconChart,
  IconCheck,
  IconContacts,
  IconFolder,
  IconGauge,
  IconHome,
  IconKey,
  IconList,
  IconLogout,
  IconMenu,
  IconPeople,
  IconReceipt,
  IconWallet,
  IconWave,
} from '#/components/icons'
import { getMe, logout } from '#/server/fns'

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const user = await getMe()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  component: Layout,
})

type Role = 'owner' | 'finance' | 'admin' | 'hr'
const ALL: Role[] = ['owner', 'finance', 'admin', 'hr']

/** Same pages, sections and role access as the original app, plus Payment run, Approvals and All transactions. */
const NAV = [
  { section: 'Overview', to: '/', label: 'Dashboard', icon: IconHome, roles: ['owner', 'finance'] },
  { section: 'Operations', to: '/projects', label: 'Projects', icon: IconFolder, roles: ['owner', 'finance', 'admin'] },
  { section: 'Operations', to: '/budget', label: 'Budget Control', icon: IconGauge, roles: ['owner', 'finance', 'admin'] },
  { section: 'Operations', to: '/invoicing', label: 'Invoicing', icon: IconReceipt, roles: ['owner', 'finance'] },
  { section: 'Operations', to: '/expenses', label: 'Expenses', icon: IconWallet, roles: ['owner', 'finance', 'admin'] },
  { section: 'Operations', to: '/payables', label: 'Payment run', icon: IconCalendar, roles: ['owner', 'finance'] },
  { section: 'Operations', to: '/approvals', label: 'Approvals', icon: IconCheck, roles: ALL },
  { section: 'Reporting', to: '/performance', label: 'Performance', icon: IconChart, roles: ['owner', 'finance'] },
  { section: 'Reporting', to: '/cashflow', label: 'Cash Flow', icon: IconWave, roles: ['owner', 'finance'] },
  { section: 'Reporting', to: '/transactions', label: 'All transactions', icon: IconList, roles: ['owner', 'finance'] },
  { section: 'People & Costs', to: '/empopex', label: 'Employee OpEx', icon: IconPeople, roles: ['owner', 'hr'] },
  { section: 'People & Costs', to: '/compopex', label: 'Company OpEx', icon: IconBuilding, roles: ['owner', 'finance', 'hr'] },
  { section: 'Admin', to: '/clients', label: 'Client List', icon: IconContacts, roles: ['owner', 'finance', 'admin'] },
  { section: 'Admin', to: '/users', label: 'User Management', icon: IconKey, roles: ['owner'] },
] as const

function NavList({ role, onPick }: { role: Role; onPick?: () => void }) {
  const items = NAV.filter((n) => (n.roles as readonly Role[]).includes(role))
  const sections = [...new Set(items.map((n) => n.section))]
  return (
    <nav className="flex flex-col gap-4">
      {sections.map((sec) => (
        <div key={sec}>
          <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">{sec}</div>
          <div className="flex flex-col gap-0.5">
            {items
              .filter((n) => n.section === sec)
              .map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={onPick}
                  activeOptions={{ exact: to === '/' }}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-2 transition hover:bg-black/[0.04]"
                  activeProps={{ className: '!bg-black/[0.06] !text-ink' }}
                >
                  <Icon />
                  {label}
                </Link>
              ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

function Layout() {
  const { user } = Route.useRouteContext()
  const role = user.role as Role
  const router = useRouter()
  const [menu, setMenu] = useState(false)
  const path = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => setMenu(false), [path])
  const signOut = async () => {
    await logout()
    await router.navigate({ to: '/login' })
  }
  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface/70 px-3 py-5 backdrop-blur md:flex">
        <div className="flex items-center gap-2.5 px-2.5 pb-6">
          <div className="grid size-7 place-items-center rounded-lg bg-brand text-[13px] font-bold text-white">S</div>
          <div className="leading-tight">
            <div className="text-[14px] font-semibold">Sagacita</div>
            <div className="text-[11px] text-muted">Finance</div>
          </div>
        </div>
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          <NavList role={role} />
        </div>
        <div className="mt-3 flex items-center gap-2.5 rounded-xl border-t border-line px-2.5 pt-3">
          <div className="grid size-8 place-items-center rounded-full bg-canvas text-[12px] font-semibold text-ink-2">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium">{user.name}</div>
            <div className="text-[11px] capitalize text-muted">{user.role}</div>
          </div>
          <button className="rounded-md p-1.5 text-muted hover:bg-black/5 hover:text-ink" title="Sign out" onClick={signOut}>
            <IconLogout />
          </button>
        </div>
      </aside>

      {/* phone: top bar + bottom tabs */}
      <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-surface/80 px-4 py-3 backdrop-blur md:hidden">
        <button className="text-ink-2" title="Menu" onClick={() => setMenu(true)}>
          <IconMenu />
        </button>
        <span className="text-[15px] font-semibold">Sagacita Finance</span>
        <button className="ml-auto text-muted" title="Sign out" onClick={signOut}>
          <IconLogout />
        </button>
      </header>
      {menu && (
        <div className="fixed inset-0 z-20 bg-black/20 md:hidden" onClick={() => setMenu(false)}>
          <div
            className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-surface px-3 py-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <NavList role={role} onPick={() => setMenu(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 pb-12 pt-6 md:px-10 md:pb-12 md:pt-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
