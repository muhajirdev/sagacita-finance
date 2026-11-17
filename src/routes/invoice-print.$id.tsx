import { createFileRoute } from '@tanstack/react-router'

import { rp } from '#/lib/format'
import { getInvoicePrint } from '#/server/pages'

/**
 * Printable client invoice. "Download PDF" is the browser's own print → Save as PDF, so there is no PDF library.
 * Simple default layout until the client shares her template. Bank and logo come from the invoice's division.
 */
export const Route = createFileRoute('/invoice-print/$id')({
  head: () => ({ meta: [{ title: 'Invoice · Sagacita' }, { name: 'robots', content: 'noindex' }] }),
  loader: ({ params }) => getInvoicePrint({ data: { id: Number(params.id) } }),
  component: InvoicePrint,
})

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const longDate = (d: string | null) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  return `${day} ${MONTHS[m - 1]} ${y}`
}

const ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas']
/** Indonesian amount in words ("terbilang"), as Indonesian invoices print it. */
export function terbilang(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n < 12) return ONES[n]
  if (n < 20) return `${ONES[n - 10]} belas`
  if (n < 100) return `${ONES[Math.floor(n / 10)]} puluh ${terbilang(n % 10)}`.trim()
  if (n < 200) return `seratus ${terbilang(n - 100)}`.trim()
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} ratus ${terbilang(n % 100)}`.trim()
  if (n < 2000) return `seribu ${terbilang(n - 1000)}`.trim()
  const units: [number, string][] = [
    [1e12, 'triliun'],
    [1e9, 'miliar'],
    [1e6, 'juta'],
    [1e3, 'ribu'],
  ]
  for (const [u, w] of units) if (n >= u) return `${terbilang(Math.floor(n / u))} ${w} ${terbilang(n % u)}`.trim()
  return ''
}

function InvoicePrint() {
  const { inv, division, company, client } = Route.useLoaderData()
  const total = inv.dpp + inv.ppn
  const due = total - inv.pph
  const pphLabel = inv.pph_type === 'pph23' ? 'PPh 23 withheld by client (2%)' : 'Tax withheld by client'
  const words = terbilang(due)
  return (
    <div className="min-h-screen bg-[#f3f3f1] py-8 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 14mm } @media print { .no-print { display: none !important } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4">
        <a className="btn-ghost" href="/invoicing">
          ← Back to invoices
        </a>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted">Choose "Save as PDF" in the print window</span>
          <button className="btn" onClick={() => window.print()}>
            Download PDF
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[210mm] bg-white px-[14mm] py-[14mm] text-[13px] leading-relaxed text-black shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            {division?.logo ? (
              <img src={division.logo} alt={division.name} className="mb-3 max-h-16 max-w-[220px] object-contain" />
            ) : (
              <div className="mb-3 text-[20px] font-bold">{division?.name ?? company?.name}</div>
            )}
            <div className="font-semibold">{company?.name}</div>
            {division && division.name !== company?.name && <div className="text-[12px] text-neutral-600">{division.name}</div>}
            {company?.address && <div className="whitespace-pre-line text-[12px] text-neutral-600">{company.address}</div>}
            {company?.npwp && <div className="text-[12px] text-neutral-600">NPWP {company.npwp}</div>}
          </div>
          <div className="text-right">
            <div className="text-[28px] font-bold tracking-wide">INVOICE</div>
            <table className="ml-auto mt-2 text-[12px]">
              <tbody>
                <tr>
                  <td className="pr-3 text-neutral-500">Invoice No.</td>
                  <td className="font-semibold">{inv.number ?? '—'}</td>
                </tr>
                <tr>
                  <td className="pr-3 text-neutral-500">Date</td>
                  <td>{longDate(inv.issue_date)}</td>
                </tr>
                <tr>
                  <td className="pr-3 text-neutral-500">Due date</td>
                  <td>{longDate(inv.due_date)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Bill to</div>
            <div className="mt-1 font-semibold">{client?.legal_entity || client?.name || inv.client}</div>
            {client?.address && <div className="whitespace-pre-line text-[12px] text-neutral-600">{client.address}</div>}
            {client?.npwp && <div className="text-[12px] text-neutral-600">NPWP {client.npwp}</div>}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Project</div>
            <div className="mt-1">
              {inv.project_code && <span className="font-semibold">{inv.project_code} </span>}
              {inv.project_name}
            </div>
          </div>
        </div>

        <table className="mt-8 w-full border-collapse">
          <thead>
            <tr className="border-y border-black text-left text-[11px] uppercase tracking-wider">
              <th className="py-2 pr-2 font-semibold">No.</th>
              <th className="py-2 pr-2 font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Amount (IDR)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-300 align-top">
              <td className="py-3 pr-2">1</td>
              <td className="py-3 pr-2">
                {inv.description || inv.project_name || 'Professional services'}
                {inv.note && <div className="text-[12px] text-neutral-600">{inv.note}</div>}
              </td>
              <td className="py-3 text-right tabular-nums">{rp(inv.dpp)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <table className="w-[300px] text-[13px]">
            <tbody>
              <tr>
                <td className="py-1 text-neutral-600">Subtotal (DPP)</td>
                <td className="py-1 text-right tabular-nums">{rp(inv.dpp)}</td>
              </tr>
              {inv.ppn > 0 && (
                <tr>
                  <td className="py-1 text-neutral-600">VAT / PPN 11%</td>
                  <td className="py-1 text-right tabular-nums">{rp(inv.ppn)}</td>
                </tr>
              )}
              <tr className="border-t border-black font-semibold">
                <td className="py-1">Total</td>
                <td className="py-1 text-right tabular-nums">{rp(total)}</td>
              </tr>
              {inv.pph > 0 && (
                <>
                  <tr>
                    <td className="py-1 text-neutral-600">{pphLabel}</td>
                    <td className="py-1 text-right tabular-nums">({rp(inv.pph)})</td>
                  </tr>
                  <tr className="border-t border-black font-semibold">
                    <td className="py-1">Amount to pay</td>
                    <td className="py-1 text-right tabular-nums">{rp(due)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        {words && (
          <div className="mt-3 text-[12px] italic text-neutral-600">
            Terbilang: {words.charAt(0).toUpperCase() + words.slice(1)} rupiah
          </div>
        )}

        <div className="mt-10 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Please transfer to</div>
            {division?.bank_account_number ? (
              <div className="mt-1">
                <div className="font-semibold">{division.bank_name}</div>
                <div className="tabular-nums">{division.bank_account_number}</div>
                <div>a.n. {division.bank_account_name}</div>
              </div>
            ) : (
              <div className="no-print mt-1 text-[12px] text-red-600">
                No bank account set for {division?.name ?? 'this division'}. Add it in PTs &amp; Divisions.
              </div>
            )}
          </div>
          <div className="text-center">
            <div className="text-[12px] text-neutral-600">{company?.name}</div>
            <div className="h-20" />
            <div className="mx-auto w-48 border-t border-black pt-1 text-[12px]">Authorized signature</div>
          </div>
        </div>
      </div>
    </div>
  )
}
