import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'

async function createPwaPlugin(): Promise<PluginOption> {
  const globalWithDirname = globalThis as typeof globalThis & { __dirname?: string }
  // Node 26 exposes "." here while Vite loads config; vite-plugin-pwa needs a real module path.
  if (globalWithDirname.__dirname === '.') {
    delete globalWithDirname.__dirname
  }

  const { VitePWA } = await import('vite-plugin-pwa')
  return VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg'],
    manifest: false, // use public/manifest.json
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      runtimeCaching: [
        {
          urlPattern: /^https?:\/\/.*/i,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'pos-network-cache',
            expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
          },
        },
      ],
    },
  })
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    await createPwaPlugin(),
  ],
}))
