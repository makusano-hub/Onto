import { defineConfig } from 'vite';

// Reenvía /fuseki/... a Fuseki para que el navegador no tenga problemas de CORS
const proxy = {
  '/fuseki': {
    target: 'http://localhost:3030',
    rewrite: (ruta) => ruta.replace(/^\/fuseki/, '')
  }
};

export default defineConfig({
  base: './',
  server: { proxy },
  preview: { proxy },
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        atraccion: 'atraccion.html'
      }
    }
  }
});
