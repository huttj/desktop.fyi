import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [cloudflare(), react()],
  // Quickdraw is linked from vendor/, outside node_modules; make sure it
  // shares this app's React rather than resolving its own copy.
  resolve: { dedupe: ['react', 'react-dom'] },
})
