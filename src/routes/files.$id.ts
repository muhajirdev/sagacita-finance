import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'

import { SESSION_COOKIE, bearerMatches, readSession } from '#/lib/auth'
import { getDb } from '#/lib/db'
import { attachDocument, getDocument } from '#/lib/finance'
import { users } from '#/db/schema'
import { eq } from 'drizzle-orm'

/** Who is asking: a signed-in web user (cookie) or the MCP token, with their role. */
async function caller(request: Request): Promise<{ who: string; role: string } | null> {
  if (bearerMatches(request, env.MCP_TOKEN)) return { who: 'mcp', role: 'mcp' }
  const cookie = request.headers
    .get('cookie')
    ?.split(/;\s*/)
    .find((c) => c.startsWith(SESSION_COOKIE + '='))
    ?.slice(SESSION_COOKIE.length + 1)
  const id = await readSession(cookie ? decodeURIComponent(cookie) : undefined, env.SESSION_SECRET)
  if (!id) return null
  const u = await getDb().select({ email: users.email, role: users.role }).from(users).where(eq(users.id, id)).get()
  return u ? { who: u.email, role: u.role } : null
}

/** Employee files (contracts) are HR data: owner and HR only, like the employee list. */
const canSeeEmployee = (role: string) => role === 'owner' || role === 'hr'

export const Route = createFileRoute('/files/$id')({
  server: {
    handlers: {
      /** Serves a stored document. */
      GET: async ({ request, params }) => {
        const me = await caller(request)
        if (!me) return new Response('Sign in to view this file', { status: 401 })
        const doc = await getDocument(getDb(), Number(params.id))
        if (doc?.entity === 'employee' && !canSeeEmployee(me.role)) return new Response('Not found', { status: 404 })
        const obj = doc ? await env.DOCS.get(doc.r2Key) : null
        if (!doc || !obj) return new Response('Not found', { status: 404 })
        return new Response(obj.body, {
          headers: {
            'content-type': doc.contentType,
            'content-disposition': `inline; filename="${doc.filename.replace(/"/g, '')}"`,
            'cache-control': 'private, max-age=3600',
          },
        })
      },
      /** Upload from the web: POST /files/<id>?entity=transaction|party|project|employee, multipart field "file". */
      POST: async ({ request, params }) => {
        const me = await caller(request)
        if (!me) return new Response('Sign in first', { status: 401 })
        const form = await request.formData()
        const file = form.get('file')
        if (!(file instanceof File)) return new Response('No file', { status: 400 })
        const entity = (new URL(request.url).searchParams.get('entity') ?? 'transaction') as 'transaction' | 'party' | 'project' | 'employee'
        if (entity === 'employee' && !canSeeEmployee(me.role)) return new Response("You don't have access to this section", { status: 403 })
        try {
          const doc = await attachDocument(getDb(), env.DOCS, me.who, env.APP_URL || new URL(request.url).origin, {
            entity,
            entityId: Number(params.id),
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            bytes: await file.arrayBuffer(),
            kind: String(form.get('kind') ?? '') || null,
          })
          return Response.json(doc)
        } catch (e) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 400 })
        }
      },
    },
  },
})
