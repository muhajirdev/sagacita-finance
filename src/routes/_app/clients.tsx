import { createFileRoute, useRouter } from '@tanstack/react-router'

import { PageHeader } from '#/components/ui'
import { addClientFn, getClients, updateClientFn } from '#/server/pages'
import { ui, type PromptField } from '#/components/dialogs'

export const Route = createFileRoute('/_app/clients')({
  loader: () => getClients(),
  component: Clients,
})

type Client = ReturnType<typeof Route.useLoaderData>[number]

function fields(c?: Client): PromptField[] {
  return [
    { name: 'name', label: 'Brand name', defaultValue: c?.name ?? '', required: true },
    { name: 'legalEntity', label: 'PT entity', defaultValue: c?.legalEntity ?? '', hint: 'As on the invoice, e.g. PT Aletra Mobil Nusantara' },
    {
      name: 'code',
      label: 'Client code',
      defaultValue: c?.code ?? '',
      hint: '2 to 5 letters used in project codes, e.g. AMN in 26AMN1117. Left empty, it is made from the brand name.',
    },
    { name: 'npwp', label: 'NPWP', defaultValue: c?.npwp ?? '' },
    { name: 'address', label: 'Address', defaultValue: c?.address ?? '' },
    {
      name: 'paymentTermsDays',
      label: 'Standard TOP (days)',
      type: 'number',
      min: 0,
      defaultValue: c?.paymentTermsDays != null ? String(c.paymentTermsDays) : '',
      hint: 'From the contract. New invoices for this client get this due date by default.',
    },
  ]
}

function toData(v: Record<string, string>) {
  const top = v.paymentTermsDays.trim()
  return {
    name: v.name.trim(),
    legalEntity: v.legalEntity.trim() || null,
    code: v.code.trim() || null,
    npwp: v.npwp.trim() || null,
    address: v.address.trim() || null,
    paymentTermsDays: top === '' ? null : Number(top),
  }
}

function Clients() {
  const clients = Route.useLoaderData()
  const router = useRouter()
  return (
    <>
      <PageHeader
        title="Client List"
        sub={`${clients.length} clients. Projects pick their client from this list.`}
        right={
          <button
            className="btn"
            onClick={async () => {
              const v = await ui.prompt('Add client', fields(), { submitLabel: 'Add client' })
              if (!v?.name.trim()) return
              if (await ui.run(() => addClientFn({ data: toData(v) }), 'Client added')) await router.invalidate()
            }}
          >
            + Add client
          </button>
        }
      />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Brand</th>
              <th className="th">Code</th>
              <th className="th">PT entity</th>
              <th className="th">NPWP</th>
              <th className="th">Address</th>
              <th className="th num">TOP</th>
              <th className="th num">Projects</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td className="td font-medium">{c.name}</td>
                <td className="td font-mono text-[12px]">{c.code ?? '—'}</td>
                <td className="td text-ink-2">{c.legalEntity ?? '—'}</td>
                <td className="td text-ink-2">{c.npwp ?? '—'}</td>
                <td className="td max-w-xs truncate text-ink-2" title={c.address ?? ''}>
                  {c.address ?? '—'}
                </td>
                <td className="td num">{c.paymentTermsDays != null ? `${c.paymentTermsDays} d` : '—'}</td>
                <td className="td num">{c.projects}</td>
                <td className="td">
                  <button
                    className="btn-ghost"
                    onClick={async () => {
                      const v = await ui.prompt(`Edit ${c.name}`, fields(c))
                      if (!v) return
                      if (await ui.run(() => updateClientFn({ data: { id: c.id, ...toData(v) } }), 'Client saved'))
                        await router.invalidate()
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
