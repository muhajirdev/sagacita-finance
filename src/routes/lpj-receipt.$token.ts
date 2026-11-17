import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'

import { getDb } from '#/lib/db'
import { attachDocument } from '#/lib/finance'
import { lpjByToken } from '#/lib/lpj'

const ALLOWED = /^(image\/|application\/pdf$)/

/** Receipt upload from the public LPJ page: POST multipart "file". Stored on the advance as a receipt. */
export const Route = createFileRoute('/lpj-receipt/$token')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const db = getDb()
        const got = await lpjByToken(db, params.token)
        if (!got) return new Response('This LPJ link is not valid.', { status: 404 })
        if (got.advance.settled) return new Response('This advance is already settled; the link is closed.', { status: 410 })
        const form = await request.formData()
        const file = form.get('file')
        if (!(file instanceof File)) return new Response('No file', { status: 400 })
        if (!ALLOWED.test(file.type)) return new Response('Upload a photo or a PDF', { status: 400 })
        try {
          const doc = await attachDocument(db, env.DOCS, `LPJ link: ${got.advance.person ?? 'advance holder'}`, env.APP_URL || new URL(request.url).origin, {
            entity: 'transaction',
            entityId: got.advance.id,
            filename: file.name || 'receipt',
            contentType: file.type,
            bytes: await file.arrayBuffer(),
            kind: 'receipt',
          })
          return Response.json({ id: doc.id, filename: doc.filename })
        } catch (e) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 400 })
        }
      },
    },
  },
})
