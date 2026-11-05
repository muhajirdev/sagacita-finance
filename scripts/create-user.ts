/**
 * Adds a user to D1.
 *   pnpm user:create <email> <password> "<name>" [owner|finance|admin] [--remote]
 */
import { spawnSync } from 'node:child_process'

import { hashPassword } from '../src/lib/auth'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const [email, password, name, role = 'finance'] = args
if (!email || !password || !name) {
  console.error('usage: pnpm user:create <email> <password> "<name>" [owner|finance|admin] [--remote]')
  process.exit(1)
}
const where = process.argv.includes('--remote') ? '--remote' : '--local'
const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const hash = await hashPassword(password)
const statement = `INSERT INTO users (email, name, role, password_hash) VALUES (${q(email.toLowerCase())}, ${q(name)}, ${q(role)}, ${q(hash)});`
const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'sagacita-finance', where, '--command', statement], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
