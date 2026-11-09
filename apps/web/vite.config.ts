import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Where the Nest API lives. Locally that's :3000; in docker compose it's the
// `api` service, passed in via API_PROXY_TARGET.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    // Browser calls /api/* on the Vite origin; Vite forwards to Nest.
    // Same origin => no CORS setup, and no API URL baked into the bundle.
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
});
