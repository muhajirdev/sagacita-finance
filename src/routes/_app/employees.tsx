import { createFileRoute } from '@tanstack/react-router'

import { PageHeader } from '#/components/ui'
import { Employees } from '#/components/hr'
import { getEmployees, getPayroll } from '#/server/pages'

export const Route = createFileRoute('/_app/employees')({
  loader: async () => {
    const [employees, payroll] = await Promise.all([getEmployees(), getPayroll({ data: {} })])
    return { employees, divisions: payroll.divisions }
  },
  component: EmployeesPage,
})

function EmployeesPage() {
  const { employees, divisions } = Route.useLoaderData()
  return (
    <>
      <PageHeader title="Employees" sub="Employee database: NIK, NPWP, position, PTKP, BPJS numbers and the employment contract. Owner and HR only." />
      <Employees employees={employees} divisions={divisions} />
    </>
  )
}
