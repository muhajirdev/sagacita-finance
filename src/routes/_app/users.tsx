import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { Modal, PageHeader, fdate } from '#/components/ui'
import { USER_ROLES } from '#/db/schema'
import { addUserFn, getUsers, resetPasswordFn, setRoleFn } from '#/server/pages'

export const Route = createFileRoute('/_app/users')({
  loader: () => getUsers(),
  component: Users,
})

const ROLE_HELP: Record<string, string> = {
  owner: 'Everything, including payroll, approvals and users',
  finance: 'Projects, budgets, invoicing, expenses, reports',
  admin: 'Projects, budget control, expenses, clients',
  hr: 'Employee OpEx and Company OpEx',
}

function Users() {
  const users = Route.useLoaderData()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  return (
    <>
      <PageHeader
        title="User Management"
        sub="Who can sign in to the web app, and what each role sees."
        right={
          <button className="btn" onClick={() => setOpen(true)}>
            + Add user
          </button>
        }
      />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Name</th>
              <th className="th">Email</th>
              <th className="th">Role</th>
              <th className="th">Added</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.name}</td>
                <td className="td">{u.email}</td>
                <td className="td">
                  <select
                    className="input w-auto py-1"
                    defaultValue={u.role}
                    onChange={async (e) => {
                      try {
                        await setRoleFn({ data: { id: u.id, role: e.target.value as (typeof USER_ROLES)[number] } })
                      } catch (x) {
                        alert(x instanceof Error ? x.message : String(x))
                      }
                      await router.invalidate()
                    }}
                  >
                    {USER_ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="td text-ink-2">{fdate(u.createdAt.slice(0, 10))}</td>
                <td className="td text-right">
                  <button
                    className="btn-ghost"
                    onClick={async () => {
                      const pw = prompt(`New password for ${u.email} (min 8 characters)`)
                      if (!pw) return
                      try {
                        await resetPasswordFn({ data: { id: u.id, password: pw } })
                        alert('Password changed')
                      } catch (x) {
                        alert(x instanceof Error ? x.message : String(x))
                      }
                    }}
                  >
                    Set password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 grid gap-2 text-[13px] text-ink-2 sm:grid-cols-2">
        {USER_ROLES.map((r) => (
          <div key={r}>
            <span className="font-medium capitalize text-ink">{r}</span>: {ROLE_HELP[r]}
          </div>
        ))}
      </div>

      {open && (
        <Modal title="Add user" onClose={() => setOpen(false)}>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              try {
                await addUserFn({
                  data: {
                    name: String(f.get('name')),
                    email: String(f.get('email')),
                    role: f.get('role') as (typeof USER_ROLES)[number],
                    password: String(f.get('password')),
                  },
                })
                setOpen(false)
                await router.invalidate()
              } catch (x) {
                setErr(x instanceof Error ? x.message : String(x))
              }
            }}
          >
            <label className="field">
              Name
              <input className="input" name="name" required />
            </label>
            <label className="field">
              Email
              <input className="input" name="email" type="email" required />
            </label>
            <label className="field">
              Role
              <select className="input" name="role" defaultValue="finance">
                {USER_ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Temporary password (min 8 characters)
              <input className="input" name="password" type="text" minLength={8} required />
            </label>
            {err && <p className="text-[13px] text-bad">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost py-2" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn">Add user</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
