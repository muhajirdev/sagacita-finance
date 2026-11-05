import type { PPH_TYPES } from '#/db/schema'

export type PphType = (typeof PPH_TYPES)[number]

export const PPN_RATE = 0.11

/** Default withholding rates. pph21 depends on the person, so it must be given as an amount. */
export const PPH_RATES: Record<PphType, number | null> = {
  none: 0,
  pph21: null,
  pph23: 0.02,
  pph4_2: 0.1,
  pph26: 0.2,
}

export type TaxInput = {
  dpp: number
  /** false when the vendor is not PKP (no VAT on the bill). */
  withPpn?: boolean
  pphType?: PphType
  /** Overrides the default rate. Required for pph21. */
  pph?: number
}

export type TaxResult = { dpp: number; ppn: number; pphType: PphType; pph: number; total: number }

/** total = dpp + ppn - pph: the cash that should actually move. Integer rupiah. */
export function computeTax(input: TaxInput): TaxResult {
  const dpp = Math.round(input.dpp)
  if (!Number.isFinite(dpp) || dpp < 0) throw new Error('dpp must be a positive number')
  const pphType = input.pphType ?? 'none'
  const ppn = input.withPpn === false ? 0 : Math.round(dpp * PPN_RATE)
  let pph: number
  if (input.pph != null) pph = Math.round(input.pph)
  else {
    const rate = PPH_RATES[pphType]
    if (rate == null) throw new Error(`${pphType} has no fixed rate; pass the pph amount`)
    pph = Math.round(dpp * rate)
  }
  return { dpp, ppn, pphType, pph, total: dpp + ppn - pph }
}
