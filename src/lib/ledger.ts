/**
 * Buku Besar (general ledger) by chart of accounts. Same rows as the P&L (pnlByAccount), one line each:
 * non-void transactions by issue date (dpp), plus payroll months from Employee OpEx on the Salary / BPJS /
 * PPh 21 (Employee) accounts. Spend is a debit, income a credit. The running balance is on the account's
 * normal side (credit for revenue / other income, debit for the rest), so each account's closing balance
 * equals its P&L line for the same filters.
 */
import type { ListFilter } from '#/lib/filters'

export type LedgerEntry = {
  date: string
  number: string | null
  description: string
  project: string | null
  party: string | null
  division: string | null
  debit: number
  credit: number
  balance: number
  txId: number | null
}
export type LedgerAccount = {
  key: string
  group: string
  code: string | null
  name: string
  debit: number
  credit: number
  balance: number
  entries: LedgerEntry[]
}

const ORDER = ['revenue', 'cost_of_service', 'operating_expense', 'other_income', 'other_expense', 'income_tax']
const creditNormal = (group: string) => group === 'revenue' || group === 'other_income'

const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number)
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

export async function generalLedger(d1: D1Database, companyId: number, f: ListFilter) {
  const where: string[] = []
  const args: unknown[] = [companyId]
  if (f.from) (where.push('t.issue_date >= ?'), args.push(f.from))
  if (f.to) (where.push('t.issue_date <= ?'), args.push(f.to))
  if (f.divisionId) (where.push('coalesce(pr.division_id, t.division_id) = ?'), args.push(f.divisionId))
  if (f.clientId) (where.push('pr.client_id = ?'), args.push(f.clientId))
  if (f.projectCode) (where.push('pr.code = ?'), args.push(f.projectCode))
  const rows = (
    await d1
      .prepare(
        `select t.id, t.issue_date, t.number, t.description, t.category, t.kind, t.direction, t.dpp, t.project_id,
                a.code, a.name acc_name, a."group" grp, a.sort_order so, pr.code project, pr.name project_name, pa.name party, d.name division
         from transactions t
         left join accounts a on a.id = t.account_id
         left join projects pr on pr.id = t.project_id
         left join parties pa on pa.id = t.party_id
         left join divisions d on d.id = coalesce(pr.division_id, t.division_id)
         where t.company_id = ? and t.status != 'void' and t.kind != 'tax_payment' and t.dpp != 0${where.map((w) => ' and ' + w).join('')}
         order by t.issue_date, t.id`,
      )
      .bind(...args)
      .all<{
        id: number
        issue_date: string
        number: string | null
        description: string | null
        category: string | null
        kind: string
        direction: string
        dpp: number
        project_id: number | null
        code: string | null
        acc_name: string | null
        grp: string | null
        so: number | null
        project: string | null
        project_name: string | null
        party: string | null
        division: string | null
      }>()
  ).results

  // Payroll follows the range and division, not a client or project (same rule as the P&L).
  const pay =
    f.clientId || f.projectCode
      ? []
      : (
          await d1
            .prepare(
              `select p.period, d.name division, p.net_salary + p.allowance salary, p.bpjs_tk + p.bpjs_kes bpjs, p.pph21
               from payroll_months p join divisions d on d.id = p.division_id
               where d.company_id = ? and p.period >= ? and p.period <= ?${f.divisionId ? ' and p.division_id = ?' : ''}
               order by p.period, d.name`,
            )
            .bind(companyId, f.from?.slice(0, 7) ?? '0000', f.to?.slice(0, 7) ?? '9999', ...(f.divisionId ? [f.divisionId] : []))
            .all<{ period: string; division: string; salary: number; bpjs: number; pph21: number }>()
        ).results
  const acc = (await d1.prepare(`select code, name, "group" grp, sort_order so from accounts`).all<{ code: string; name: string; grp: string; so: number }>()).results

  const accounts = new Map<string, LedgerAccount & { so: number }>()
  const open = (group: string, code: string | null, name: string, so: number) => {
    const key = group + '|' + (code ?? name)
    let a = accounts.get(key)
    if (!a) accounts.set(key, (a = { key, group, code, name, so, debit: 0, credit: 0, balance: 0, entries: [] }))
    return a
  }
  const add = (a: LedgerAccount, e: Omit<LedgerEntry, 'balance'>) => a.entries.push({ ...e, balance: 0 })

  for (const r of rows) {
    const a = r.code
      ? open(r.grp!, r.code, r.acc_name!, r.so ?? 0)
      : r.direction === 'in'
        ? open('revenue', null, 'Not categorised', 999)
        : open(r.project_id ? 'cost_of_service' : 'operating_expense', null, 'Not categorised', 999)
    add(a, {
      date: r.issue_date,
      number: r.number,
      description: r.description || r.category || r.kind.replace(/_/g, ' '),
      project: r.project,
      party: r.party,
      division: r.division,
      debit: r.direction === 'out' ? r.dpp : 0,
      credit: r.direction === 'in' ? r.dpp : 0,
      txId: r.id,
    })
  }
  const byName = (re: RegExp) => acc.find((a) => a.grp !== 'balance' && re.test(a.name))
  for (const p of pay) {
    for (const [re, v, label] of [
      [/^Salary$/i, p.salary, 'Salary'],
      [/^BPJS Ketenagakerjaan$/i, p.bpjs, 'BPJS (company share)'],
      [/PPh\s+21 \(Employee\)/i, p.pph21, 'PPh 21 employees'],
    ] as const) {
      if (!v) continue
      const m = byName(re)
      const a = m ? open(m.grp, m.code, m.name, m.so) : open('operating_expense', null, 'Payroll', 998)
      add(a, { date: lastDay(p.period), number: null, description: `${label} ${p.period} (Employee OpEx)`, project: null, party: null, division: p.division, debit: v, credit: 0, txId: null })
    }
  }

  const list = [...accounts.values()].sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || a.so - b.so || a.name.localeCompare(b.name))
  for (const a of list) {
    a.entries.sort((x, y) => x.date.localeCompare(y.date))
    const sign = creditNormal(a.group) ? -1 : 1
    let bal = 0
    for (const e of a.entries) {
      bal += sign * (e.debit - e.credit)
      e.balance = bal
      a.debit += e.debit
      a.credit += e.credit
    }
    a.balance = bal
  }
  return {
    accounts: list.map(({ so: _so, ...a }) => a),
    totals: { debit: list.reduce((s, a) => s + a.debit, 0), credit: list.reduce((s, a) => s + a.credit, 0), entries: list.reduce((s, a) => s + a.entries.length, 0) },
  }
}
