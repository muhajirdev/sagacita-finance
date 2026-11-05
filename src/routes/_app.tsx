import { Link, Outlet, createFileRoute, redirect, useRouter } from '@tanstack/react-router'

import { IconCalendar, IconCheck, IconFolder, IconHome, IconList, IconLogout } from '#/components/icons'
import { getMe, logout } from '#/server/fns'

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const user = await getMe()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  component: Layout,
})

const NAV = [
  { to: '/', label: 'Overview', icon: IconHome },
  { to: '/projects', label: 'Projects', icon: IconFolder },
  { to: '/transactions', label: 'Transactions', icon: IconList },
  { to: '/payables', label: 'Payment run', icon: IconCalendar },
  { to: '/approvals', label: 'Approvals', icon: IconCheck },
] as const

function Layout() {
  const { user } = Route.useRouteContext()
  const router = useRouter()
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
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === '/' }}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-2 transition hover:bg-black/[0.04]"
              activeProps={{ className: '!bg-black/[0.06] !text-ink' }}
            >
              <Icon />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 rounded-xl px-2.5 py-2">
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
        <div className="grid size-7 place-items-center rounded-lg bg-brand text-[13px] font-bold text-white">S</div>
        <span className="text-[15px] font-semibold">Sagacita Finance</span>
        <button className="ml-auto text-muted" title="Sign out" onClick={signOut}>
          <IconLogout />
        </button>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === '/' }}
            className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted"
            activeProps={{ className: '!text-accent' }}
          >
            <Icon />
            {label}
          </Link>
        ))}
      </nav>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-6 md:px-10 md:pb-12 md:pt-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
