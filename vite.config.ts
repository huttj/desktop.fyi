import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

/**
 * Two ways to develop:
 *
 *   npm run dev                       the whole stack locally (worker, an empty local database)
 *   DFYI_UPSTREAM=https://desktop.fyi DFYI_TOKEN=dfyi_… npm run dev
 *                                     the client locally against a real deployment, acting as
 *                                     the token's person: every /api call and the board socket
 *                                     go upstream with the token attached
 *
 * The second is for working on the client (a new /everyone, say) with real data. The token
 * reads everything and writes only to its own desktop, so nothing else can be touched by mistake.
 */
const upstream = process.env.DFYI_UPSTREAM
const token = process.env.DFYI_TOKEN

function upstreamProxy(target: string): Record<string, ProxyOptions> {
  const withToken = (proxyReq: { setHeader(name: string, value: string): void; removeHeader?(name: string): void }) => {
    if (token) proxyReq.setHeader('authorization', `Bearer ${token}`)
    // the browser's local cookies mean nothing upstream
    proxyReq.removeHeader?.('cookie')
  }
  return {
    '/api': {
      target,
      changeOrigin: true,
      ws: true,
      configure: (proxy) => {
        proxy.on('proxyReq', withToken)
        proxy.on('proxyReqWs', withToken)
      },
    },
  }
}

export default defineConfig({
  plugins: [...(upstream ? [] : [cloudflare()]), react()],
  // Quickdraw is linked from vendor/, outside node_modules; make sure it
  // shares this app's React rather than resolving its own copy.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: upstream ? { proxy: upstreamProxy(upstream) } : undefined,
})
