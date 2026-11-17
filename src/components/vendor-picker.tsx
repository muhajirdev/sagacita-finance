import { useState } from 'react'

import { ui } from '#/components/dialogs'
import { addVendorFn } from '#/server/pages'
import { vendorData, vendorFields } from '#/lib/vendor-form'

type Vendor = {
  id: number
  name: string
  bankName?: string | null
  bankAccount?: string | null
}

/** Searchable vendor dropdown with "+ Add new vendor" (opens the full vendor form). Submits the vendor name as `name`. */
export function VendorPicker({ vendors, name }: { vendors: Vendor[]; name: string }) {
  const [list, setList] = useState(vendors)
  const [value, setValue] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const needle = q.trim().toLowerCase()
  const shown = list.filter((v) => !needle || v.name.toLowerCase().includes(needle)).slice(0, 50)

  const addNew = async () => {
    setOpen(false)
    const r = await ui.prompt('Add vendor', vendorFields({ name: q.trim() }), {
      submitLabel: 'Add vendor',
    })
    if (!r?.name.trim()) return
    const data = vendorData(r)
    let added: Vendor | null = null
    const ok = await ui.run(async () => {
      added = (await addVendorFn({ data })) as Vendor
    }, 'Vendor added')
    if (!ok || !added) return
    const v: Vendor = added
    setList((l) => [...l.filter((x) => x.id !== v.id), v].sort((a, b) => a.name.localeCompare(b.name)))
    setValue(v.name)
    setQ(v.name)
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />
      <input
        className="input w-full"
        required
        placeholder="Search the vendor list"
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setValue(list.find((v) => v.name.toLowerCase() === e.target.value.trim().toLowerCase())?.name ?? '')
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onInvalid={(e) =>
          (e.currentTarget as HTMLInputElement).setCustomValidity(value ? '' : 'Pick a vendor from the list, or add a new one')
        }
        onInput={(e) => (e.currentTarget as HTMLInputElement).setCustomValidity('')}
      />
      {q && !value && !open && <div className="mt-1 text-[12px] text-warn">Not in the vendor list yet. Pick one or add it.</div>}
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
          {shown.map((v) => (
            <button
              key={v.id}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-black/[0.05]"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setValue(v.name)
                setQ(v.name)
                setOpen(false)
              }}
            >
              <div className="font-medium">{v.name}</div>
              {(v.bankName || v.bankAccount) && (
                <div className="text-[11px] text-muted">{[v.bankName, v.bankAccount].filter(Boolean).join(' ')}</div>
              )}
            </button>
          ))}
          {shown.length === 0 && <div className="px-3 py-1.5 text-[13px] text-muted">No vendor matches</div>}
          <button
            type="button"
            className="block w-full border-t border-line px-3 py-2 text-left text-[13px] font-medium text-brand hover:bg-black/[0.05]"
            onMouseDown={(e) => e.preventDefault()}
            onClick={addNew}
          >
            + Add new vendor{q.trim() ? ` "${q.trim()}"` : ''}
          </button>
        </div>
      )}
    </div>
  )
}
