import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { login } from '#/server/fns'

export const Route = createFileRoute('/login')({ component: Login })

function Login() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        method="post"
        className="card w-full max-w-sm space-y-3 p-6"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          const res = await login({ data: { email: String(f.get('email')), password: String(f.get('password')) } })
          setBusy(false)
          if (!res.ok) return setError(res.error)
          await router.navigate({ to: '/' })
        }}
      >
        <h1 className="text-xl font-semibold">Sagacita Finance</h1>
        <input className="input" name="email" type="email" placeholder="Email" required />
        <input className="input" name="password" type="password" placeholder="Password" required />
        <button className="btn w-full" disabled={busy}>
          Sign in
        </button>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </form>
    </div>
  )
}
