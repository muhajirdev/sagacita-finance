import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { PageHeader } from "#/components/ui";
import { Select, ui } from "#/components/dialogs";
import { TAX_TYPES } from "#/db/schema";
import { rp } from "#/lib/format";
import { getTax, recordTaxPaymentFn } from "#/server/pages";

export const Route = createFileRoute("/_app/tax")({
  validateSearch: z.object({
    year: z.coerce.number().int().optional(),
    company: z.coerce.number().int().optional(),
  }),
  loaderDeps: ({ search }) => ({ year: search.year, company: search.company }),
  loader: ({ deps }) =>
    getTax({ data: { year: deps.year, companyId: deps.company } }),
  component: Tax,
});

const LABEL: Record<string, string> = {
  pph21: "PPh 21",
  pph23: "PPh 23",
  pph4_2: "PPh 4(2) / final",
  pph26: "PPh 26",
  ppn: "PPN",
  bpjs_tk: "BPJS TK",
  bpjs_kes: "BPJS Kes",
};
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function Tax() {
  const d = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const types = TAX_TYPES.filter((t) => d.rows.some((r) => r.type === t));
  const cell = (period: string, type: string) =>
    d.rows.find((r) => r.period === period && r.type === type);
  const periods = [...new Set(d.rows.map((r) => r.period))].sort();
  const open = d.rows.filter((r) => r.due > 0 && r.type !== "ppn");
  const late = open.filter((r) => r.deadline < d.today);
  const company = d.companies.find((c) => c.id === d.companyId);

  const record = async (pre?: {
    period?: string;
    type?: string;
    amount?: number;
  }) => {
    const v = await ui.prompt(
      "Record tax payment",
      [
        {
          name: "taxType",
          label: "Tax",
          type: "select",
          options: TAX_TYPES.map((t) => ({ value: t, label: LABEL[t] })),
          defaultValue: pre?.type ?? "pph23",
        },
        {
          name: "period",
          label: "Tax month (masa pajak)",
          type: "month",
          defaultValue: pre?.period ?? d.today.slice(0, 7),
        },
        {
          name: "amount",
          label: "Amount paid (IDR)",
          type: "number",
          min: 1,
          defaultValue: pre?.amount ? String(pre.amount) : "",
        },
        {
          name: "date",
          label: "Date paid",
          type: "date",
          defaultValue: d.today,
        },
        { name: "number", label: "NTPN / billing code", required: false },
      ],
      { submitLabel: "Record", message: `For ${company?.name ?? "this PT"}` },
    );
    if (!v) return;
    const ok = await ui.run(
      () =>
        recordTaxPaymentFn({
          data: {
            companyId: d.companyId,
            taxType: v.taxType as (typeof TAX_TYPES)[number],
            period: v.period,
            amount: Number(v.amount),
            date: v.date,
            number: v.number || undefined,
          },
        }),
      "Tax payment recorded",
    );
    if (ok) await router.invalidate();
  };

  return (
    <>
      <PageHeader
        title="Tax"
        sub="Tax owed per month from the books (PPh withheld on bills, PPh 21 and BPJS from Employee OpEx, PPN out minus in) against what was deposited. PPh and BPJS are due the 15th of the next month, PPN the end of the next month."
        right={
          <button className="btn whitespace-nowrap" onClick={() => record()}>
            + Record tax payment
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-32">
          <Select
            value={String(d.companyId)}
            onChange={(v) =>
              navigate({ search: { year: d.year, company: Number(v) } })
            }
            options={d.companies.map((c) => ({
              value: String(c.id),
              label: c.code ?? c.name,
            }))}
          />
          <Select
            value={String(d.year)}
            onChange={(v) =>
              navigate({ search: { year: Number(v), company: d.companyId } })
            }
            options={d.years.map((y) => ({
              value: String(y),
              label: String(y),
            }))}
          />
        </div>
        <div
          className={`ml-2 text-[13px] ${late.length ? "text-bad" : "text-muted"}`}
        >
          {open.length
            ? `${open.length} not fully deposited, Rp ${open.reduce((a, r) => a + r.due, 0).toLocaleString("id-ID")}${late.length ? ` (${late.length} past deadline)` : ""}`
            : "Everything owed is deposited."}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Tax month</th>
              {types.map((t) => (
                <th key={t} className="th num">
                  {LABEL[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p}>
                <td className="td whitespace-nowrap">
                  {MONTHS[Number(p.slice(5)) - 1]} {p.slice(0, 4)}
                </td>
                {types.map((t) => {
                  const c = cell(p, t);
                  if (!c)
                    return (
                      <td key={t} className="td num text-muted">
                        —
                      </td>
                    );
                  const bad = c.type !== "ppn" && c.due > 0;
                  return (
                    <td key={t} className="td num">
                      <div title="Owed from the books">{rp(c.owed)}</div>
                      <div
                        className={`text-[12px] ${bad ? (c.deadline < d.today ? "text-bad" : "text-warn") : "text-muted"}`}
                      >
                        {c.type === "ppn"
                          ? c.owed < 0
                            ? "input > output"
                            : `paid ${rp(c.paid)}`
                          : bad
                            ? `paid ${rp(c.paid)} · due ${c.deadline}`
                            : `paid ${rp(c.paid)}`}
                      </div>
                      {bad && (
                        <button
                          className="btn-ghost mt-1"
                          onClick={() =>
                            record({ period: p, type: t, amount: c.due })
                          }
                        >
                          Record
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {periods.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={types.length + 1}>
                  No tax for this PT in {d.year}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-10 text-[15px] font-semibold">
        Deposits in {d.year}
      </h2>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Paid on</th>
              <th className="th">Tax</th>
              <th className="th">Tax month</th>
              <th className="th">Reference</th>
              <th className="th num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.payments.map((p) => (
              <tr key={p.id}>
                <td className="td whitespace-nowrap">{p.date}</td>
                <td className="td">{LABEL[p.type] ?? p.type}</td>
                <td className="td">{p.period}</td>
                <td className="td text-[12px] text-muted">
                  {[p.number, p.description].filter(Boolean).join(" · ")}
                </td>
                <td className="td num">{rp(p.amount)}</td>
              </tr>
            ))}
            {d.payments.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={5}>
                  No tax deposits recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
