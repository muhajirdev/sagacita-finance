import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'

import { SESSION_COOKIE, bearerMatches, readSession } from '#/lib/auth'
import { getDb } from '#/lib/db'
import { attachDocument, getDocument } from '#/lib/finance'
import { users } from '#/db/schema'
import { eq } from 'drizzle-orm'

/** Who is asking: a signed-in web user (cookie) or the MCP token. */
async function caller(request: Request) {
  if (bearerMatches(request, env.MCP_TOKEN)) return 'mcp'
  const cookie = request.headers
    .get('cookie')
    ?.split(/;\s*/)
    .find((c) => c.startsWith(SESSION_COOKIE + '='))
    ?.slice(SESSION_COOKIE.length + 1)
  const id = await readSession(cookie ? decodeURIComponent(cookie) : undefined, env.SESSION_SECRET)
  if (!id) return null
  return (await getDb().select({ email: users.email }).from(users).where(eq(users.id, id)).get())?.email ?? null
}

export const Route = createFileRoute('/files/$id')({
  server: {
    handlers: {
      /** Serves a stored document. */
      GET: async ({ request, params }) => {
        if (!(await caller(request))) return new Response('Sign in to view this file', { status: 401 })
        const doc = await getDocument(getDb(), Number(params.id))
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
      /** Upload from the web: POST /files/<transaction id>?entity=transaction, multipart field "file". */
      POST: async ({ request, params }) => {
        const who = await caller(request)
        if (!who) return new Response('Sign in first', { status: 401 })
        const form = await request.formData()
        const file = form.get('file')
        if (!(file instanceof File)) return new Response('No file', { status: 400 })
        const entity = (new URL(request.url).searchParams.get('entity') ?? 'transaction') as 'transaction' | 'party' | 'project'
        try {
          const doc = await attachDocument(getDb(), env.DOCS, who, env.APP_URL || new URL(request.url).origin, {
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
