import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      // In dev the app calls /api/* and this forwards to the local backend, so
      // VITE_API_URL can be left blank. The backend mounts its router at /api,
      // so the path is passed through unchanged (no rewrite).
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // FIXED — the single bundle is ~1.6 MB raw. recharts and the icon set are
    // the bulk of it and are not needed to paint the login screen, so they are
    // split into their own chunks. Pure config change: no code moved.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
