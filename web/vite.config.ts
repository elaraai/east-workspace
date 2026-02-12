// Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
// Proprietary and confidential.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
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
