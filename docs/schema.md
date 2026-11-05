# Data model

The app is operated mainly through MCP (an AI agent on WhatsApp), so the
schema is built to be easy to scan: one wide `transactions` table holds the raw
finance data, and nothing that can be computed is stored as a status.

## Audit of the old Supabase schema

| # | Problem in the old schema | Why it hurts | Fix here |
|---|---|---|---|
| 1 | `expenses.amount` is one number | No PPN / PPh, so no tax view and no "cash to pay" vs "cost" | `dpp`, `ppn`, `pph_type`, `pph`, `total` on every transaction |
| 2 | Expense status `Advance Request / Paid / Done Settlement` used for every category | "Advance Request" means nothing for a vendor bill; partial payment impossible | Status is only the approval step (`draft / approved / settled / void`). Paid is computed from `payments` |
| 3 | No `due_date` on expenses | Wed/Fri payment run cannot be picked by due date | `due_date` on transactions |
| 4 | `invoices.status = 'Overdue'` is stored | Goes stale the day after it is set | Overdue is derived: `due_date < today` and not fully paid |
| 5 | Expenses and invoices are separate tables with different shapes | Every question about money needs two queries; agent has to learn both | One `transactions` table, `direction` in/out, `kind` says what it is |
| 6 | No company / PT entity, division is a hard-coded CHECK list, copied onto expenses | Tax per PT impossible; expense division can disagree with its project | `companies` and `divisions` tables; division comes from the project |
| 7 | Vendor is free text (`vendor_name`) | "PT ABC" and "ABC" count as two vendors; no spend per vendor | `parties` table (clients, vendors, employees), referenced by id |
| 8 | `sow_item_id ... on delete set null` | Deleting a SOW item silently un-budgets its expenses | Budget lines are not deleted while transactions point at them |
| 9 | Dead columns `projects.asf_enabled / asf_percent` after the ASF migration | Confusing for people and for the agent | Dropped; ASF is `budget_lines.asf_amount` |
| 10 | `numeric` money handled as JS floats | Rounding drift on sums | Integer rupiah everywhere |
| 11 | No audit trail, `requested_by` free text | Can't tell who changed what, or whether it came from WhatsApp | `activity_log` + `source` (`web / whatsapp / import`) + `created_by` |
| 12 | No attachment link | Receipt photo lives only in a chat | `attachment_url` |
| 13 | Company OpEx is a separate actuals table | Two ways to record spend | Company spend is a transaction with no project and a `category` |

Payroll is kept as monthly totals per division in `payroll_months`, outside
`transactions`, because salaries are owner/hr only. The MCP `query` tool cannot
read it (or `users`). No screens yet for payroll, OpEx budgets, Performance or
Cash Flow; the data model is ready for them.

## Tables

```
companies ──< divisions ──< projects >── parties (client)
                               │
                               └──< budget_lines
transactions  (the raw data, one wide row each)
  kind         client_invoice | vendor_bill | cash_advance | reimbursement
  direction    in | out
  status       draft | approved | settled | void
  company, party, project, budget_line, category, description
  issue_date, due_date, dpp, ppn, pph_type, pph, total
  requested_by, attachment_url, source, created_by
payments      (cash that moved; partial payment = several rows)
  transaction_id, direction, amount, date, method, reference
opex_budgets  (company OpEx: category, fiscal_year, annual_budget, is_fixed)
payroll_months (period, division, net_salary, bpjs_tk, bpjs_kes, pph21; owner/hr only)
approvals     (entity project|transaction, entity_id, status pending|approved|rejected, summary, amount, requested_by, decided_by, notified_at)
activity_log  (who changed what)
users
```

## Derived numbers (never stored)

- **paid** = `sum(payments.amount)` for the transaction
- **outstanding** = `total - paid`
- **overdue** = `due_date < today and outstanding > 0 and status != 'void'`
- **budget ceiling** of a line = `max_expense + asf_amount` (same rule as the old dashboard)
- **actual spend** of a line = `sum(dpp)` of its non-void `out` transactions
  (cost before tax; PPN is recoverable and PPh is a withholding, so neither is project cost)
- **actual margin** = `charge - actual spend`

The `v_transactions` view joins the names in and adds `paid`, `outstanding`
and `overdue`, so the agent can answer most questions from one place.
