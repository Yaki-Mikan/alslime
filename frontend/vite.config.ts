import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'

const appName = 'AlSlime'
const themeColor = '#111827'
const pwaIconPurpose = 'any maskable'
const pwaIcons = [
  {
    src: '/icons/app-192.png',
    sizes: '192x192',
    type: 'image/png',
    purpose: pwaIconPurpose
  },
  {
    src: '/icons/app-512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: pwaIconPurpose
  }
]

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // dev 時のみ、別ポートで起動したバックエンドへ /api・/images を中継する。
  // 同一オリジン扱いになり CORS が発生しない。転送先は VITE_DEV_PROXY_TARGET で上書き可
  // （既定はローカルデバッグ用の 127.0.0.1:32124）。
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:32124'

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          disableDevLogs: true,
          // 画面のプログラムが既定の上限（2MiB）に近いため、先読みから外れないよう広げる
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          // 字体（しっぽり明朝）は文字の範囲ごとに分かれた多数のファイル。先読みせず、使った分だけ保存する
          runtimeCaching: [
            {
              urlPattern: /\.woff2$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'alslime-fonts',
                expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 365 }
              }
            }
          ]
        },
        manifest: {
          name: appName,
          short_name: appName,
          theme_color: themeColor,
          background_color: themeColor,
          display: 'standalone',
          scope: '/',
          start_url: '/',
          icons: pwaIcons
        }
      })
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false
    },
    esbuild: {
      drop: ['console', 'debugger']
    },
    server: {
      host: true,  // LANからのアクセスを許可
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true },
        '/images': { target: proxyTarget, changeOrigin: true }
      }
    }
  }
})
