import { describe, expect, it } from 'vitest'

import { computeTax } from './tax'

describe('computeTax', () => {
  it('adds PPN 11% and withholds PPh 23 2%', () => {
    expect(computeTax({ dpp: 10_000_000, pphType: 'pph23' })).toEqual({
      dpp: 10_000_000,
      ppn: 1_100_000,
      pphType: 'pph23',
      pph: 200_000,
      total: 10_900_000,
    })
  })
  it('skips PPN for non-PKP vendors', () => {
    expect(computeTax({ dpp: 500_000, withPpn: false }).total).toBe(500_000)
  })
  it('needs an explicit amount for PPh 21', () => {
    expect(() => computeTax({ dpp: 1_000_000, pphType: 'pph21' })).toThrow()
    expect(computeTax({ dpp: 1_000_000, pphType: 'pph21', pph: 25_000 }).pph).toBe(25_000)
  })
})
