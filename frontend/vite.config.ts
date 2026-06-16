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
          urlPattern: /^https?:\/\/.*(?:identitytoolkit|firestore)\.googleapis\.com\/.*/i,
          handler: 'NetworkOnly',
        },
        {
          urlPattern: /^https?:\/\/.*\.(?:js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)(\?.*)?$/i,
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/zustand')) {
            return 'vendor-zustand';
          }
          if (id.includes('node_modules/firebase/app')) {
            return 'vendor-firebase-app';
          }
          if (id.includes('node_modules/firebase/auth')) {
            return 'vendor-firebase-auth';
          }
          // Ref: #321 — Firestore SDK (349KB) isolated into its own chunk.
          // Already lazy-loaded via dynamic import() in firebaseModules.ts.
          // This manualChunks entry ensures Vite doesn't merge it into the main bundle.
          if (id.includes('node_modules/firebase/firestore')) {
            return 'vendor-firebase-firestore';
          }
          if (id.includes('node_modules/firebase')) {
            return 'vendor-firebase-shared';
          }
        },
      },
    },
  },
}))
