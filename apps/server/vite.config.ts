import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node22',
    outDir: 'dist',
    clean: true,
    dts: false,
    platform: 'node',
    sourcemap: false,
    // tsdown 的 ESM 默认产物是 .mjs；这里固定为 .js，与 start 脚本一致
    outExtensions: () => ({ js: '.js' }),
    // 内联 workspace 包，使 dist/ 自包含
    deps: {
      resolveDepSubpath: true,
      alwaysBundle: [/^@cardvault\/shared(\/|$)/],
    },
  },
})
