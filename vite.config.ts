import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/tiles': {
        target: 'https://tiles.openfreemap.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tiles/, ''),
      },
    },
  },
});
