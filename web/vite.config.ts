// Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
// Proprietary and confidential.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',  // Relative paths - works at any /repos/{tenant}/ base
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to local e3-api-server during development
      '/repos': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
