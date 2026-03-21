import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const rawBase = env.VITE_API_BASE_URL || ''
  const normalized = rawBase.endsWith('/api') ? rawBase.slice(0, -4) : rawBase
  const target = normalized && !['auto', 'same-origin'].includes(normalized)
    ? normalized
    : 'http://localhost:8001'

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
  }
})
