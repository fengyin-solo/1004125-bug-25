/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_APP_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// 由 vite.config.ts 的 define 注入：应用版本与依赖版本指纹，本地数据层用来做播种版本判断。
declare const __APP_VERSION__: string
declare const __DEP_FINGERPRINT__: string
