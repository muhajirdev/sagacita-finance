# Sagacita Finance

Budget control and finance for Sagacita Group, built to be run mainly by an AI
agent over MCP (WhatsApp through Whip). The web UI is a thin view on the same data.

TanStack Start on Cloudflare Workers, D1 (SQLite) with Drizzle.

- Data model and the audit of the old Supabase app: [docs/schema.md](./docs/schema.md)
- Schema: `src/db/schema.ts`. Migrations: `drizzle/` (`pnpm db:generate` after schema changes; never hand-edit generated SQL)
- All money logic: `src/lib/finance.ts` and `src/lib/tax.ts`, shared by the UI and MCP
- MCP server: `src/mcp/server.ts`, served at `/mcp` with `Authorization: Bearer <MCP_TOKEN>`

## MCP tools

| Tool | What it does |
|---|---|
| `describe_schema` | Tables, the `v_transactions` view and the money rules |
| `query` | One read-only SELECT over everything (users table hidden; payroll is readable) |
| `list_reference` | Companies and divisions with ids |
| `list_projects` | Projects with budget totals |
| `project_budget` | Budget vs actual per budget line |
| `payables_due` | Approved unpaid outgoing items due by a date (payment run) |
| `record_transaction` | Client invoice, vendor bill, cash advance or reimbursement; PPN/PPh computed |
| `set_transaction_status` | Approve, settle or void |
| `record_payment` | Cash in or out against a transaction, partial allowed |
| `create_project`, `add_budget_line` | Set up a project (starts as draft) |
| `submit_budget` | Ask for approval of a draft project's budget lines; approval makes it active |
| `list_approvals` | Approval queue; `unnotified: true` returns new requests once, for a WhatsApp routine |
| `decide_approval` | Approve or reject (approve spend = payable, reject = void) |
| `update_transaction` | Fix amount, tax, dates, vendor or line on a transaction with no payments |
| `undo_payment` | Delete a payment recorded by mistake |
| `update_budget_line` | Change or delete (if unused) a budget line; warns when an approved budget changes |
| `set_project_status` | Close or reopen a project |
| `update_project` | Edit a project: number, name, client, division, type, dates |
| `set_opex_budget` | Annual budget of a Company OpEx category |
| `create_party` | Add a client, vendor or employee (with NPWP, bank account) |
| `update_party` | NPWP, bank account, name, notes of a client / vendor / employee |
| `payroll_summary`, `record_payroll` | Employee OpEx: monthly payroll totals per division |
| `attach_document`, `list_documents` | Keep invoice photos, KTP, NPWP, contracts in R2 on a transaction, party or project |
| `pnl_report` | Whole-year P&L in one call: totals, monthly series, per-project rows |

### Approvals

Outgoing spend recorded as `draft` opens a pending approval automatically. New projects start as `draft`;
`submit_budget` asks for approval and approving makes the project `active`. One `approvals` table holds both
(entity = project | transaction). On the web, only the `owner` role can decide; over MCP the token is shared,
so restrict who may approve in Whip (e.g. only the owner's WhatsApp number).

WhatsApp ping: a Whip routine every 10 minutes calls `list_approvals {unnotified: true}` and posts each
summary with its id; the owner replies "approve 12" or "reject 12 reason" and the agent calls `decide_approval`.

Every write takes an `actor` (e.g. `whatsapp:Rina`) and lands in `activity_log`.

## Develop

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm user:create you@example.com secret "Your Name" owner
pnpm dev          # http://localhost:3000
pnpm test && pnpm typecheck
```

## Deploy

```bash
npx wrangler d1 create sagacita-finance     # once; put the id in wrangler.jsonc
pnpm db:migrate:remote
npx wrangler secret put SESSION_SECRET
npx wrangler secret put MCP_TOKEN
pnpm deploy
pnpm user:create you@example.com secret "Your Name" owner --remote
```

Then add the MCP server in Whip as a custom connector: `https://<worker>/mcp` with the `MCP_TOKEN` as bearer.
