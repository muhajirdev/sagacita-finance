import { createFileRoute, useRouter } from '@tanstack/react-router'

import { PageHeader } from '#/components/ui'
import { addClientFn, getClients } from '#/server/pages'
import { ui } from '#/components/dialogs'

export const Route = createFileRoute('/_app/clients')({
  loader: () => getClients(),
  component: Clients,
})

function Clients() {
  const clients = Route.useLoaderData()
  const router = useRouter()
  return (
    <>
      <PageHeader
        title="Client List"
        sub={`${clients.length} clients`}
        right={
          <button
            className="btn"
            onClick={async () => {
              const v = await ui.prompt('Add client', [{ name: 'name', label: 'Client name' }], { submitLabel: 'Add client' })
              const name = v?.name.trim()
              if (!name) return
              if (await ui.run(() => addClientFn({ data: { name } }), 'Client added')) await router.invalidate()
            }}
          >
            + Add client
          </button>
        }
      />
      <div className="card max-w-2xl overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Client</th>
              <th className="th">NPWP</th>
              <th className="th num">Projects</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td className="td font-medium">{c.name}</td>
                <td className="td text-ink-2">{c.npwp ?? '—'}</td>
                <td className="td num">{c.projects}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
