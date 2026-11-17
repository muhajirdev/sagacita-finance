import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { PageHeader } from '#/components/ui'
import { addVendorFn, getVendors, updateVendorFn } from '#/server/pages'
import { ui, type PromptField } from '#/components/dialogs'

export const Route = createFileRoute('/_app/vendors')({
  loader: () => getVendors(),
  component: Vendors,
})

type Vendor = ReturnType<typeof Route.useLoaderData>[number]

function fields(v?: Vendor): PromptField[] {
  const f = (name: keyof Vendor & string, label: string, hint?: string): PromptField => ({
    name,
    label,
    defaultValue: (v?.[name] as string | null | undefined) ?? '',
    hint,
    required: false,
  })
  return [
    { ...f('name', 'Vendor name', 'The name picked on vendor invoices'), required: true },
    f('legalEntity', 'PT name', 'As on their invoice, e.g. PT Pamarta Pratama Pradipta'),
    f('npwp', 'NPWP'),
    f('address', 'Address'),
    f('picName', 'PIC name'),
    f('phone', 'Phone'),
    f('email', 'Email'),
    f('bankName', 'Bank name', 'e.g. BCA, Mandiri'),
    f('accountName', 'Account holder name'),
    f('bankAccount', 'Account number'),
  ]
}

function toData(v: Record<string, string>) {
  const t = (k: string) => v[k]?.trim() || null
  return {
    name: v.name.trim(),
    legalEntity: t('legalEntity'),
    npwp: t('npwp'),
    address: t('address'),
    picName: t('picName'),
    phone: t('phone'),
    email: t('email'),
    bankName: t('bankName'),
    accountName: t('accountName'),
    bankAccount: t('bankAccount'),
  }
}

function Vendors() {
  const vendors = Route.useLoaderData()
  const router = useRouter()
  const [q, setQ] = useState('')
  const shown = vendors.filter((v) =>
    [v.name, v.legalEntity, v.picName, v.accountName].some((s) => s?.toLowerCase().includes(q.trim().toLowerCase())),
  )
  return (
    <>
      <PageHeader
        title="Vendor List"
        sub={`${vendors.length} vendors. Vendor invoices pick their vendor from this list.`}
        right={
          <div className="flex items-center gap-2">
            <input className="input w-48" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            <button
              className="btn whitespace-nowrap"
              onClick={async () => {
                const v = await ui.prompt('Add vendor', fields(), { submitLabel: 'Add vendor' })
                if (!v?.name.trim()) return
                if (await ui.run(() => addVendorFn({ data: toData(v) }), 'Vendor added')) await router.invalidate()
              }}
            >
              + Add vendor
            </button>
          </div>
        }
      />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Vendor</th>
              <th className="th">PT name</th>
              <th className="th">NPWP</th>
              <th className="th">PIC</th>
              <th className="th">Bank</th>
              <th className="th num">Bills</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v.id}>
                <td className="td font-medium">{v.name}</td>
                <td className="td text-ink-2">{v.legalEntity ?? '—'}</td>
                <td className="td text-ink-2">{v.npwp ?? '—'}</td>
                <td className="td text-ink-2">
                  {v.picName || v.phone || v.email ? (
                    <>
                      <div>{v.picName ?? '—'}</div>
                      <div className="text-[12px] text-muted">{[v.phone, v.email].filter(Boolean).join(' · ')}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="td text-ink-2">
                  {v.bankName || v.bankAccount ? (
                    <>
                      <div>
                        {v.bankName ?? ''} <span className="font-mono text-[12px]">{v.bankAccount ?? ''}</span>
                      </div>
                      <div className="text-[12px] text-muted">{v.accountName ?? ''}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="td num">{v.bills}</td>
                <td className="td">
                  <button
                    className="btn-ghost"
                    onClick={async () => {
                      const r = await ui.prompt(`Edit ${v.name}`, fields(v))
                      if (!r) return
                      if (await ui.run(() => updateVendorFn({ data: { id: v.id, ...toData(r) } }), 'Vendor saved'))
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
