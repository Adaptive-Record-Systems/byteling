import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'path';

// Standalone build for the embeddable web component.
// Produces a single self-contained dist/embed.js (React + lantern art inlined)
// that defines <byteling-companion> and can be dropped onto any page.
// NOTE: deliberately does NOT use the Base44 vite plugin — the embed must not
// inject any app-shell/analytics; it's just the custom element.
export default defineConfig({
  plugins: [react()],
  // Lib mode doesn't replace this the way the app build does; without it the
  // bundled React hits `process is not defined` in a plain browser and the
  // whole IIFE throws before registering the custom element.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false, // append to the main site build, don't wipe it
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000, // inline the lantern PNGs → one self-contained file
    lib: {
      entry: path.resolve(process.cwd(), 'src/embed/byteling-companion.jsx'),
      name: 'BytelingCompanion',
      fileName: () => 'embed.js',
      formats: ['iife'],
    },
  },
});
