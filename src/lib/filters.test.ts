import { describe, expect, it } from 'vitest'

import { rangeOf } from './filters'

describe('rangeOf', () => {
  it('year, quarter, month', () => {
    expect(rangeOf({ year: 2025 })).toEqual({ from: '2025-01-01', to: '2025-12-31' })
    expect(rangeOf({ year: 2025, period: 'q1' })).toEqual({ from: '2025-01-01', to: '2025-03-31' })
    expect(rangeOf({ year: 2024, period: 'm02' })).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(rangeOf({ year: 2025, period: 'q4' })).toEqual({ from: '2025-10-01', to: '2025-12-31' })
  })
  it('all years and custom range', () => {
    expect(rangeOf({ year: 'all', period: 'q1' })).toEqual({})
    expect(rangeOf({ from: '2025-03-05', to: '2025-04-01', year: 2024 })).toEqual({ from: '2025-03-05', to: '2025-04-01' })
  })
})
