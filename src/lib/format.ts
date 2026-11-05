export const rp = (n: number | null | undefined) =>
  'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID')

export const rpShort = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e9) return `Rp ${(n / 1e9).toFixed(1)}M`
  if (a >= 1e6) return `Rp ${(n / 1e6).toFixed(1)}jt`
  return rp(n)
}

export const KIND_LABEL: Record<string, string> = {
  client_invoice: 'Client invoice',
  vendor_bill: 'Vendor bill',
  cash_advance: 'Cash advance',
  reimbursement: 'Reimbursement',
}

export const nextWeekday = (weekday: number) => {
  const d = new Date()
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7))
  return d.toISOString().slice(0, 10)
}
