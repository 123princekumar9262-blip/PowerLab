import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { handleTutor, limiterFor } from './api/tutor.ts'

/**
 * The tutor endpoint (api/tutor.ts) on the local dev and preview servers, as Vercel serves it in production.
 * GEMINI_API_KEY is read from the environment / .env.local by this Node process only — it is not a VITE_
 * variable, so Vite never puts it into the browser bundle.
 */
function tutorApi(mode: string): Plugin {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env } as Record<string, string | undefined>
  const limiter = limiterFor(env)
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const ctl = new AbortController()
    res.on('close', () => ctl.abort())
    const chunks: Buffer[] = []
    let size = 0
    for await (const c of req) {
      size += (c as Buffer).length
      if (size > 64_000) break // the handler refuses anything over its own limit anyway
      chunks.push(c as Buffer)
    }
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
    if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'local')
    const request = new Request(`http://${req.headers.host ?? 'localhost'}/api/tutor`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
      signal: ctl.signal,
    })
    const out = await handleTutor(request, { env, fetch, limiter, now: Date.now })
    res.statusCode = out.status
    out.headers.forEach((v, k) => res.setHeader(k, v))
    if (!out.body) return res.end()
    const reader = out.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
    res.end()
  }
  // returns nothing on purpose: a function returned from these hooks would be run by Vite as a post-hook
  const mount = (server: { middlewares: { use(path: string, fn: (req: IncomingMessage, res: ServerResponse) => void): unknown } }): void => {
    server.middlewares.use('/api/tutor', (req, res) => {
      handle(req, res).catch(() => {
        if (!res.headersSent) res.statusCode = 500
        res.end()
      })
    })
  }
  return { name: 'tutor-api', configureServer: mount, configurePreviewServer: mount }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tutorApi(mode)],
  test: {
    // The simulation engine is framework-free, so tests run in plain Node.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Some suites run dozens of full simulations; allow them time under parallel load.
    testTimeout: 180_000,
  },
}))
