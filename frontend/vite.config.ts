import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Prefer explicit process env so E2E / WSL wrappers can override proxy target reliably.
  const rawBase = process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL || ''
  const normalized = rawBase.endsWith('/api') ? rawBase.slice(0, -4) : rawBase
  const target = normalized && !['auto', 'same-origin'].includes(normalized)
    ? normalized
    : 'http://127.0.0.1:8081'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      // 3D graph mode is intentionally isolated in an async vendor chunk.
      // Keep the warning threshold above that chunk while preserving manual split boundaries.
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined
            }
            if (id.includes('@mui') || id.includes('@emotion')) {
              return 'vendor-mui'
            }
            if (id.includes('3d-force-graph') || id.includes('three') || id.includes('three-spritetext')) {
              return 'vendor-graph-3d'
            }
            if (id.includes('cytoscape')) {
              return 'vendor-cytoscape'
            }
            if (id.includes('d3-')) {
              return 'vendor-d3'
            }
            if (id.includes('recharts')) {
              return 'vendor-charts'
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'vendor-react'
            }
            return 'vendor'
          },
        },
      },
    },
  }
})
