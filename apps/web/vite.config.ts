import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// .env 放在仓库根，apps/web 与 apps/server 共用
const repoRoot = resolve(import.meta.dirname, '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '')
  const apiTarget = env.VITE_API_TARGET ?? `http://127.0.0.1:${env.PORT ?? 52188}`
  return {
    plugins: [react()],
    server: {
      host: env.WEB_HOST ?? '0.0.0.0',
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false },
        '/media': { target: apiTarget, changeOrigin: false },
      },
    },
    build: {
      // 由同一个 Node 进程托管：apps/server/dist/client
      outDir: '../server/dist/client',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: true,
    },
  }
})
