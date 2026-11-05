import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'

import { handleMcpRequest } from '#/mcp/server'

const handle = ({ request }: { request: Request }) => handleMcpRequest(request, env)

export const Route = createFileRoute('/mcp')({
  server: { handlers: { GET: handle, POST: handle, DELETE: handle, OPTIONS: handle } },
})
