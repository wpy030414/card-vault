import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  outDir: 'dist',
  sourcemap: false,
  // 内联 workspace 包，使 dist/ 自包含
  noExternal: ['@cardvault/shared'],
})
