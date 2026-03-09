import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  build: {
    outDir: '../views/v2',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
