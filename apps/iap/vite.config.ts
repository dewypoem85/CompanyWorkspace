import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins:[react()], build:{outDir:'dist/client'}, server:{host:'127.0.0.1',port:4181,proxy:{'/api':'http://127.0.0.1:4180','/auth':'http://127.0.0.1:4180'}} });
