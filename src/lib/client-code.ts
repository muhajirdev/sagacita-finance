/** Client codes: the brand initials inside project codes (AMN in 26AMN1117). Pure, so they can be unit tested. */

/** Brand initials for project codes: letters only, upper case, 2 to 5 of them. */
export function cleanClientCode(code: string | null | undefined) {
  const c = (code ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!c) return null
  if (c.length < 2 || c.length > 5) throw new Error('client code must be 2 to 5 letters, e.g. AMN')
  return c
}

/** Default initials from a brand name: first letter of each word ("Aletra Mobil Nusantara" -> AMN), or the first 3 letters of one word. */
export function suggestClientCode(name: string) {
  const words = name
    .replace(/\b(PT|Tbk|Ltd|LLC|Inc)\b\.?/gi, ' ')
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
  const c = words.length >= 2 ? words.slice(0, 3).map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3)
  return c.toUpperCase().padEnd(3, 'X')
}

