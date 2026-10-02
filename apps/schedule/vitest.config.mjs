import {defineConfig,mergeConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
import viteConfig from './vite.config.ts';

// Test the real common read runtime without broadening the development server's file access.
export default mergeConfig(viteConfig,defineConfig({server:{fs:{allow:[
  fileURLToPath(new URL('.',import.meta.url)),
  fileURLToPath(new URL('../../packages/workspace-ui/src/',import.meta.url))
]}}}));
