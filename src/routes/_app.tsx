import { Link, Outlet, createFileRoute, redirect, useRouter } from '@tanstack/react-router'

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
  { to: '/', label: 'Dashboard' },
  { to: '/projects', label: 'Projects' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/payables', label: 'Payment run' },
] as const

function Layout() {
  const { user } = Route.useRouteContext()
  const router = useRouter()
  return (
    <div className="mx-auto max-w-6xl px-4 py-5">
      <header className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="text-lg font-semibold">Sagacita Finance</span>
        <nav className="flex flex-wrap gap-1">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === '/' }}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-stone-200"
              activeProps={{ className: 'bg-stone-900 text-white hover:bg-stone-900' }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-stone-500">
          {user.name}
          <button
            className="btn-ghost"
            onClick={async () => {
              await logout()
              await router.navigate({ to: '/login' })
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
