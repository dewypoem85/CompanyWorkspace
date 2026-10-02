import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  server: {
    port: 4200,
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
