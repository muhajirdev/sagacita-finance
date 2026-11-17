import { describe, expect, it } from 'vitest'
import { checkNpwp, cleanNik } from './employee'

describe('employee ids', () => {
  it('accepts a 16 digit NIK with separators', () => expect(cleanNik('3171 0123.4567-8901')).toBe('3171012345678901'))
  it('refuses a short NIK', () => expect(() => cleanNik('317101234567')).toThrow('16 digits'))
  it('refuses letters', () => expect(() => cleanNik('317101234567890A')).toThrow())
  it('NPWP is optional', () => expect(checkNpwp('  ')).toBeNull())
  it('accepts formatted NPWP', () => expect(checkNpwp('01.234.567.8-901.000')).toBe('01.234.567.8-901.000'))
  it('refuses a bad NPWP', () => expect(() => checkNpwp('12345')).toThrow())
})
