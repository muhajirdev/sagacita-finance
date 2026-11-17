import { createFileRoute, useRouter } from '@tanstack/react-router'

import { PageHeader } from '#/components/ui'
import { addCompanyFn, addDivisionFn, getCompanies, renameDivisionFn, updateCompanyFn } from '#/server/pages'
import { ui, type PromptField } from '#/components/dialogs'

export const Route = createFileRoute('/_app/companies')({
  loader: () => getCompanies(),
  component: Companies,
})

type Company = ReturnType<typeof Route.useLoaderData>[number]

const fields = (c?: Company): PromptField[] => [
  { name: 'name', label: 'PT name', defaultValue: c?.name ?? '', hint: 'Full legal name, e.g. PT Bangun Reputasi Anak Bangsa' },
  { name: 'code', label: 'Short name', defaultValue: c?.code ?? '', hint: 'What people call it, e.g. BRAB', required: false },
  { name: 'npwp', label: 'NPWP', defaultValue: c?.npwp ?? '', required: false },
  { name: 'address', label: 'Address', defaultValue: c?.address ?? '', required: false },
]
const toData = (v: Record<string, string>) => ({
  name: v.name.trim(),
  code: v.code?.trim() || null,
  npwp: v.npwp?.trim() || null,
  address: v.address?.trim() || null,
})

function Companies() {
  const companies = Route.useLoaderData()
  const router = useRouter()
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (await ui.run(fn, ok)) await router.invalidate()
  }
  return (
    <>
      <PageHeader
        title="PTs & Divisions"
        sub="Each PT is a legal entity (tax is reported per PT). Divisions are the agencies under it; a project's PT comes from its division."
        right={
          <button
            className="btn whitespace-nowrap"
            onClick={async () => {
              const v = await ui.prompt('Add PT', fields(), { submitLabel: 'Add PT' })
              if (v?.name.trim()) await run(() => addCompanyFn({ data: toData(v) }), 'PT added')
            }}
          >
            + Add PT
          </button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {companies.map((c) => (
          <div key={c.id} className="card p-5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">
                  {c.code && <span className="mr-2 rounded bg-black/[0.05] px-1.5 py-0.5 text-[12px]">{c.code}</span>}
                  {c.name}
                </div>
                <div className="mt-0.5 text-[12px] text-muted">{[c.npwp && `NPWP ${c.npwp}`, c.address].filter(Boolean).join(' · ') || 'No NPWP or address yet'}</div>
              </div>
              <button
                className="btn-ghost"
                onClick={async () => {
                  const v = await ui.prompt(`Edit ${c.code ?? c.name}`, fields(c), { submitLabel: 'Save' })
                  if (v?.name.trim()) await run(() => updateCompanyFn({ data: { id: c.id, ...toData(v) } }), 'Saved')
                }}
              >
                Edit
              </button>
            </div>
            <div className="mt-4 divide-y divide-line border-t border-line">
              {c.divisions.map((d) => (
                <div key={d.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <div className="flex-1">{d.name}</div>
                  <div className="text-[12px] text-muted">{d.projects} projects</div>
                  <button
                    className="btn-ghost"
                    onClick={async () => {
                      const v = await ui.prompt('Rename division', [{ name: 'name', label: 'Division name', defaultValue: d.name }])
                      if (v?.name.trim()) await run(() => renameDivisionFn({ data: { id: d.id, name: v.name.trim() } }), 'Renamed')
                    }}
                  >
                    Rename
                  </button>
                </div>
              ))}
              {c.divisions.length === 0 && <div className="py-2 text-[13px] text-muted">No divisions yet.</div>}
            </div>
            <button
              className="btn-ghost mt-2"
              onClick={async () => {
                const v = await ui.prompt(`Add division to ${c.code ?? c.name}`, [{ name: 'name', label: 'Division name', hint: 'e.g. Arra Comms' }])
                if (v?.name.trim()) await run(() => addDivisionFn({ data: { companyId: c.id, name: v.name.trim() } }), 'Division added')
              }}
            >
              + Add division
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
