import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { PageHeader } from '#/components/ui'
import { Select } from '#/components/dialogs'
import { MedicalClaims } from '#/components/hr'
import { getEmployees, getMedicalClaims } from '#/server/pages'

export const Route = createFileRoute('/_app/medical')({
  validateSearch: z.object({ year: z.coerce.number().int().optional() }),
  loaderDeps: ({ search }) => ({ year: search.year ?? new Date().getFullYear() }),
  loader: async ({ deps }) => {
    const [employees, claims] = await Promise.all([getEmployees(), getMedicalClaims({ data: { year: deps.year } })])
    return { employees, claims, year: deps.year }
  },
  component: MedicalPage,
})

function MedicalPage() {
  const { employees, claims, year } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  return (
    <>
      <PageHeader
        title="Medical"
        sub="Yearly medical allowance per employee (outpatient, inpatient, dental, vision share one ceiling). Claims go through approval and the payment run."
        right={
          <div className="w-28">
            <Select
              value={String(year)}
              onChange={(v) => navigate({ search: { year: Number(v) } })}
              options={[2025, 2026, 2027].map((y) => ({ value: String(y), label: String(y) }))}
            />
          </div>
        }
      />
      <MedicalClaims data={claims} employees={employees} year={year} />
    </>
  )
}
