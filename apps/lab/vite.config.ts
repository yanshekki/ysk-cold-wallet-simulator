import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    headers: {
      'Permissions-Policy': 'bluetooth=(self)',
    },
  },
});
