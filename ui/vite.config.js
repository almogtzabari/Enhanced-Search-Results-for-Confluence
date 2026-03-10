import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  build: {
    outDir: '../.build/views',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
