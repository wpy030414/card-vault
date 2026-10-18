import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: { semi: false, singleQuote: true },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    // 必须显式排除，否则 vp lint 会扫描 node_modules
    ignorePatterns: ['**/node_modules/**', '**/dist/**'],
    options: { typeAware: true, typeCheck: true },
  },
})
