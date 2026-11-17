/** NIK from the KTP: 16 digits. Spaces, dots and dashes are dropped. Returns the clean NIK or throws. */
export function cleanNik(v: string) {
  const d = v.replace(/[\s.-]/g, '')
  if (!/^\d{16}$/.test(d)) throw new Error('NIK (KTP) must be 16 digits')
  return d
}

/** NPWP is optional: 15 digits (old format) or 16 (NIK-based). Kept as typed when valid. */
export function checkNpwp(v: string | null | undefined) {
  const s = v?.trim()
  if (!s) return null
  const d = s.replace(/[\s.-]/g, '')
  if (!/^\d{15,16}$/.test(d)) throw new Error('NPWP must be 15 or 16 digits')
  return s
}
