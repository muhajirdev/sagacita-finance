/** Email + password users, signed session cookie. Web Crypto only, so it runs on Workers and Node. */

const ITERATIONS = 100_000
const enc = new TextEncoder()

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pbkdf2(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, key, 256)
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(await pbkdf2(password, salt))}`
}

export async function verifyPassword(password: string, stored: string) {
  const [, , salt, hash] = stored.split('$')
  if (!salt || !hash) return false
  return toB64(await pbkdf2(password, fromB64(salt))) === hash
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toB64(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

export const SESSION_COOKIE = 'sf_session'
export const SESSION_DAYS = 30

export async function signSession(userId: number, secret: string) {
  const payload = `${userId}.${Date.now() + SESSION_DAYS * 86_400_000}`
  return `${payload}.${await hmac(secret, payload)}`
}

export async function readSession(token: string | undefined, secret: string): Promise<number | null> {
  if (!token) return null
  const [id, exp, sig] = token.split('.')
  if (!id || !exp || !sig) return null
  if ((await hmac(secret, `${id}.${exp}`)) !== sig) return null
  if (Number(exp) < Date.now()) return null
  return Number(id)
}

/** Bearer token check for the MCP endpoint, without early exit on the first wrong character. */
export function bearerMatches(request: Request, expected: string | undefined) {
  if (!expected) return false
  const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
