import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

// Library build configuration for @elaraai/east-ui-patterns-components.
// Produces ESM + CJS + .d.ts. Side-effect imports register the React
// renderers against their EastUI.component carriers at module load.
export default defineConfig({
  plugins: [react(), dts()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'EastUIPatternsComponents',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: (id) =>
        [
          'react',
          'react-dom',
          'react/jsx-runtime',
          '@chakra-ui/react',
          '@elaraai/east',
          '@elaraai/east/internal',
          '@elaraai/east-ui',
          '@elaraai/east-ui-components',
          '@elaraai/east-ui-patterns',
        ].includes(id) ||
        id.startsWith('node:') ||
        id.startsWith('@elaraai/'),
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
          '@chakra-ui/react': 'ChakraUI',
        },
      },
    },
    sourcemap: true,
    minify: false,
  },
});
