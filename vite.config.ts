import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiProxy = { target: env.BACKEND_URL || `http://127.0.0.1:${env.BACKEND_PORT || '8000'}`, changeOrigin: true };
  return {
  server: {
    port: 5175,
    strictPort: true,
    // Kept only for the existing archived design previews.
    proxy: {
      '/api': apiProxy,
      '/health': apiProxy,
      '/tiles': {
        target: 'https://tiles.openfreemap.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tiles/, ''),
      },
    },
  },
  preview: { port: 5175, strictPort: true, proxy: { '/api': apiProxy, '/health': apiProxy } },
  };
});
