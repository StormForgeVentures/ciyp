import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // The monorepo keeps a single repo-root .env; read VITE_-prefixed vars from there.
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
