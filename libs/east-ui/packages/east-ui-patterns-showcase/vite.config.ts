import * as path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { feedbackPlugin } from './server/feedback-plugin'
import { exampleSourcesPlugin } from './scripts/vite-plugin-example-sources'

export default defineConfig({
  plugins: [
    react(),
    feedbackPlugin(),
    exampleSourcesPlugin({
      include: '**/*.examples.ts',
      cwd: path.resolve(__dirname, '../east-ui-patterns/test'),
    }),
  ],
  server: {
    port: 5173,
    // Bind to every interface so it's reachable from outside the box.
    host: true,
    // Vite 6 tightened Host-header validation; accept any hostname so
    // SSH tunnels, dev DNS, and reverse proxies all work without per-host
    // config. (Dev-only — never carry this into production.)
    allowedHosts: true,
    cors: true,
    // HMR through tunnels / proxies: if you're hitting the dev server via
    // a forwarded port and HMR fails to connect, set the env var
    //   VITE_HMR_HOST=your-public-host VITE_HMR_PORT=443 VITE_HMR_PROTOCOL=wss
    // before `pnpm dev`. Defaults below work for direct access on the LAN.
    hmr: process.env.VITE_HMR_HOST
      ? {
          host: process.env.VITE_HMR_HOST,
          clientPort: process.env.VITE_HMR_PORT ? Number(process.env.VITE_HMR_PORT) : undefined,
          protocol: (process.env.VITE_HMR_PROTOCOL ?? 'ws') as 'ws' | 'wss',
        }
      : true,
  },
  // Browser-side shims for Node globals referenced inside @elaraai/east
  // (regex validation reads `process.env`; East CLI helpers read `process.argv`).
  // Mirror @elaraai/east-ui-showcase's vite.config.
  define: {
    'process.env': {},
    'process.argv': '[]',
  },
  build: {
    commonjsOptions: {
      defaultIsModuleExports: true,
      include: [/sorted-btree/, /node_modules/],
    },
    rollupOptions: {
      external: (id: string) => id.startsWith('node:'),
    },
  },
  optimizeDeps: {
    exclude: ['better-sqlite3'],
    // Keep east + east-ui (and their /internal subpaths) on the same module
    // instance — otherwise type-identity comparisons inside East fail.
    include: [
      'sorted-btree',
      '@elaraai/east',
      '@elaraai/east/internal',
      '@elaraai/east-ui',
      '@elaraai/east-ui/internal',
      '@elaraai/east-ui-patterns',
      'react-dom/client',
      '@chakra-ui/react',
    ],
  },
})
