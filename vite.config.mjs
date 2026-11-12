import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Reenvía /fuseki/... a Fuseki para que el navegador no tenga problemas de CORS
const proxy = {
  '/fuseki': {
    target: 'http://localhost:3030',
    rewrite: (ruta) => ruta.replace(/^\/fuseki/, '')
  }
};

// Lista de archivos de public/modelos3d y public/imagenes, para que la validación
// detecte modelos e imágenes que existen pero ningún individuo usa (y al revés)
const CARPETAS_RECURSOS = ['modelos3d', 'imagenes'];

function recursosPublicos() {
  const ID = 'virtual:recursos';
  const listar = (carpeta) => {
    const ruta = resolve('public', carpeta);
    if (!existsSync(ruta)) return [];
    return readdirSync(ruta, { withFileTypes: true })
      .filter((entrada) => entrada.isFile())
      .map((entrada) => `${carpeta}/${entrada.name}`);
  };

  return {
    name: 'recursos-publicos',
    resolveId: (id) => (id === ID ? `\0${ID}` : null),
    load(id) {
      if (id !== `\0${ID}`) return null;
      const recursos = Object.fromEntries(CARPETAS_RECURSOS.map((carpeta) => [carpeta, listar(carpeta)]));
      return `export default ${JSON.stringify(recursos)};`;
    },
    configureServer(servidor) {
      // Al copiar o borrar un archivo, la lista se vuelve a generar
      servidor.watcher.add(CARPETAS_RECURSOS.map((carpeta) => resolve('public', carpeta)));
      const actualizar = (archivo) => {
        if (!CARPETAS_RECURSOS.some((carpeta) => archivo.includes(`public${archivo.includes('\\') ? '\\' : '/'}${carpeta}`))) return;
        const modulo = servidor.moduleGraph.getModuleById(`\0${ID}`);
        if (modulo) servidor.moduleGraph.invalidateModule(modulo);
      };
      servidor.watcher.on('add', actualizar);
      servidor.watcher.on('unlink', actualizar);
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [recursosPublicos()],
  server: { proxy },
  preview: { proxy },
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        atraccion: 'atraccion.html',
        grafo: 'grafo.html',
        panel: 'panel.html'
      }
    }
  }
});
