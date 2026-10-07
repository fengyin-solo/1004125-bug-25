import { createHash } from 'node:crypto'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import pkg from './package.json'

// 纯前端应用：没有后端，也就没有 /api 代理，数据全部走 src/api/local-service.ts。
// 版本指纹：应用版本 + 依赖版本一起注入前端，本地数据层据此判断要不要重新播种，
// 依赖版本变化后重建不会再把旧转运状态显示出来。
const depFingerprint = createHash('sha1')
  .update(JSON.stringify({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }))
  .digest('hex')
  .slice(0, 10)

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEP_FINGERPRINT__: JSON.stringify(depFingerprint),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 关掉自动打开页面：起服务时只打印地址，不拉起浏览器
    open: false,
    strictPort: false,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
