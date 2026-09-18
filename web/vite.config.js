import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        learn: 'learn.html',
        village: 'index.html',
        driving: 'driving.html',
        mario: 'mario.html',
      },
    },
  },
});
