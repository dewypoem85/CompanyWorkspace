import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  base: '/dist/',
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
    allowedHosts: ['127.0.0.1', 'localhost', 'terminal.local'],
    proxy: {
      '/api': { target: 'http://127.0.0.1:3010', changeOrigin: false },
      '/assets': { target: 'http://127.0.0.1:3010', changeOrigin: false }
    }
  },
  build: {
    outDir: '../public/dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: 'assets',
    rollupOptions: {
      output: { manualChunks: id => id.includes('node_modules/react') ? 'react' : undefined }
    }
  }
});
