import { describe, expect, it } from 'vitest'

import { cleanClientCode, suggestClientCode } from './client-code'

describe('client codes', () => {
  it('suggests initials from the brand name', () => {
    expect(suggestClientCode('Aletra Mobil Nusantara, PT')).toBe('AMN')
    expect(suggestClientCode('Sagacita')).toBe('SAG')
    expect(suggestClientCode('PT Indosat Tbk')).toBe('IND')
    expect(suggestClientCode('XL')).toBe('XLX')
  })
  it('cleans typed codes', () => {
    expect(cleanClientCode(' sgc ')).toBe('SGC')
    expect(cleanClientCode('')).toBeNull()
    expect(() => cleanClientCode('A')).toThrow()
  })
})
