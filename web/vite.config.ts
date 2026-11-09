import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // .env лежит в корне репозитория, общий с сервером
  const env = loadEnv(mode, path.resolve(import.meta.dirname, '..'), '');
  const apiPort = process.env.API_PORT ?? env.API_PORT ?? '3001';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
  };
});
