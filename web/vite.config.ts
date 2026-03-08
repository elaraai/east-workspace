// Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
// Proprietary and confidential.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    'process.argv': '[]',
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      external: [
        'stream', 'stream/promises', 'fs', 'fs/promises', 'path', 'os',
        'crypto', 'child_process', 'util', 'events', 'zlib', 'buffer',
        'node:crypto', 'node:fs', 'node:path',
      ],
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://dev.e3.elaraai.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
