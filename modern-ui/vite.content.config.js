import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [preact()],
  build: {
    outDir: '../content/v2',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    lib: {
      entry: path.resolve(__dirname, 'src/contentMain.jsx'),
      formats: ['es'],
      fileName: () => 'content-main.js',
    },
  },
});
