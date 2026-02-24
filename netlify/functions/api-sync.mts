import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

export default async (req: Request, context: Context) => {
  const store = getStore({ name: 'app-data', consistency: 'strong' })

  if (req.method === 'GET') {
    const url = new URL(req.url)
    const checkOnly = url.searchParams.get('check')

    if (checkOnly) {
      const version = await store.get('version', { type: 'text' })
      return Response.json({ version: version || '0' })
    }

    const services = await store.get('services', { type: 'json' })
    const clients = await store.get('clients', { type: 'json' })
    const version = await store.get('version', { type: 'text' })

    return Response.json({
      services: services || null,
      clients: clients || null,
      version: version || '0'
    })
  }

  if (req.method === 'POST') {
    const body = await req.json()
    const { services, clients } = body

    const currentVersion = await store.get('version', { type: 'text' })
    const newVersion = String(Number(currentVersion || '0') + 1)

    if (services !== undefined) {
      await store.setJSON('services', services)
    }
    if (clients !== undefined) {
      await store.setJSON('clients', clients)
    }
    await store.set('version', newVersion)

    return Response.json({ success: true, version: newVersion })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/sync',
  method: ['GET', 'POST']
}
