// Complemento de Vite que publica los datos: deja en el sitio compilado lo que una máquina
// puede leer sin ejecutar JavaScript ni consultar Fuseki.
//
//   datos/turismo.rdf, .ttl y .jsonld   el grafo para descargar, más las reglas SHACL
//   ficha/<id>.html                     una página por atracción con su JSON-LD y sus datos incrustados
//   index.html                          la lista de atracciones ya escrita, con enlaces a esas fichas
//   datos.html                          la descripción del conjunto de datos (schema:Dataset)
//
// Las fichas, la lista y los formatos Turtle y JSON-LD salen de Fuseki: tiene que estar en marcha
// al compilar. Sin Fuseki la compilación termina igual, solo con turismo.rdf y las reglas SHACL.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// Archivos del repositorio que se publican tal cual
const FUENTES = {
  'turismo.rdf': { origen: 'ontologia/turismo.rdf', tipo: 'application/rdf+xml', nombre: 'RDF/XML' },
  'turismo.shacl.ttl': { origen: 'ontologia/turismo.shacl.ttl', tipo: 'text/turtle', nombre: 'Reglas SHACL (Turtle)' }
};

// Otros formatos del mismo grafo: los escribe Fuseki
const FORMATOS = {
  'turismo.ttl': { tipo: 'text/turtle', nombre: 'Turtle' },
  'turismo.jsonld': { tipo: 'application/ld+json', nombre: 'JSON-LD' }
};

// Licencia de los datos: la misma que declara la ontología (dcterms:license) y que muestra datos.html
const LICENCIA = 'https://creativecommons.org/licenses/by/4.0/';

const esc = (texto) => String(texto).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// JSON dentro de <script>: "<" escapado para que ningún texto pueda cerrar la etiqueta
const script = (tipo, datos, id) =>
  `<script type="${tipo}"${id ? ` id="${id}"` : ''}>${JSON.stringify(datos).replace(/</g, '\\u003c')}</script>\n`;

async function volcado(fuseki, tipo) {
  const respuesta = await fetch(`${fuseki}/turismo/get?default`, { headers: { Accept: tipo } });
  if (!respuesta.ok) throw new Error(`Fuseki respondió ${respuesta.status} al pedir ${tipo}`);
  return respuesta.text();
}

// Todo lo que se necesita de Fuseki, con las mismas consultas y funciones que usa el sitio
async function leerFuseki(fuseki) {
  const { obtenerInventario } = await import('../js/ontologia.js');
  const { CAMPOS, datosEstructurados } = await import('../js/ficha-datos.js');
  const atracciones = await obtenerInventario(`${fuseki}/turismo/query`);
  if (!atracciones.length) throw new Error('el dataset turismo no tiene atracciones');

  const volcados = {};
  for (const [archivo, { tipo }] of Object.entries(FORMATOS)) volcados[archivo] = await volcado(fuseki, tipo);
  return { atracciones, volcados, CAMPOS, datosEstructurados };
}

// ---------- Páginas

function paginaFicha(plantilla, atraccion, { CAMPOS, datosEstructurados }) {
  const { id, nombre, tipo, comuna, descripcion, enlaces, equivalentes } = atraccion;
  const campos = CAMPOS.map(([, etiqueta, valor]) => [etiqueta, valor(atraccion)]).filter(([, texto]) => texto);
  const vinculos = [...enlaces, ...equivalentes];

  // Lo que ve quien no ejecuta JavaScript; js/script.js lo sustituye por la ficha completa con el visor 3D
  const cuerpo = `
		<article class="ficha-atraccion" data-atraccion="${esc(id)}">
			<h1 class="ficha-nombre">${esc(nombre)}</h1>
			<p class="categoria-atraccion">${esc(comuna ? `${tipo} · ${comuna}` : tipo)}</p>
			${descripcion ? `<p>${esc(descripcion)}</p>` : ''}
			<dl class="datos-atraccion">${campos.map(([etiqueta, texto]) => `<div><dt>${esc(etiqueta)}</dt><dd>${esc(texto)}</dd></div>`).join('')}</dl>
			${vinculos.length ? `<ul class="ficha-enlaces">${vinculos.map(({ url, texto }) => `<li><a href="${esc(url)}" rel="noopener noreferrer">${esc(texto)} ↗</a></li>`).join('')}</ul>` : ''}
		</article>
	`;

  // Las sustituciones usan funciones: en un texto de reemplazo, "$1" de un precio se leería como un grupo
  return plantilla
    // La ficha vive en ficha/: con <base> sus rutas (estilos, modelos, enlaces) se resuelven como en la raíz
    .replace('<head>', () => '<head>\n\t<base href="../">')
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(nombre)} | Atracciones turísticas de Magallanes</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, (_, antes, despues) =>
      `${antes}${esc(descripcion || `${nombre}: ${tipo} de la Región de Magallanes.`)}${despues}`)
    .replace('</head>', () => `${script('application/ld+json', datosEstructurados(atraccion))}${script('application/json', atraccion, 'datos-atraccion')}</head>`)
    .replace(/(<div id="ficha">)[\s\S]*?(<\/div>)/, (_, antes, despues) => `${antes}${cuerpo}${despues}`);
}

function paginaIndice(html, atracciones) {
  const tarjetas = atracciones.map(({ id, nombre, tipo, comuna, modelos }) => `
				<li><a class="card tarjeta-atraccion" href="ficha/${encodeURIComponent(id)}.html"><h3>${esc(nombre)}</h3><p>${esc(comuna ? `${tipo} · ${comuna}` : tipo)}</p>${
  modelos.length ? `<span class="etiqueta-3d">${modelos.length > 1 ? `${modelos.length} modelos 3D` : 'Modelo 3D'}</span>` : ''}</a></li>`).join('');

  const lista = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Atracciones turísticas de la Región de Magallanes',
    numberOfItems: atracciones.length,
    itemListElement: atracciones.map(({ id, nombre }, indice) => ({
      '@type': 'ListItem', position: indice + 1, name: nombre, url: `ficha/${encodeURIComponent(id)}.html`
    }))
  };

  return html
    .replace(/(<ul class="cards lista-atracciones" id="lista-atracciones")(>)(<\/ul>)/, (_, antes, cierre, fin) =>
      `${antes} data-estatica${cierre}${tarjetas}\n\t\t\t${fin}`)
    .replace(/(<p class="total-atracciones" id="total-atracciones" role="status">)(<\/p>)/, (_, antes, fin) =>
      `${antes}${atracciones.length} atracciones${fin}`)
    .replace('</head>', () => `${script('application/ld+json', lista)}</head>`);
}

// datos.html: solo enlaza los archivos que existen y describe el conjunto con schema:Dataset
function paginaDatos(html, disponibles) {
  const descargas = Object.entries({ ...FUENTES, ...FORMATOS }).filter(([archivo]) => disponibles.includes(archivo));
  const grafo = descargas.filter(([archivo]) => archivo !== 'turismo.shacl.ttl');

  const conjunto = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Ontología de turismo de la Región de Magallanes',
    description: 'Lugares, actividades, ciudades y comunas de la Región de Magallanes y de la Antártica Chilena, con sus modelos 3D, enlazados con Wikidata y alineados con schema.org.',
    inLanguage: 'es',
    license: LICENCIA,
    keywords: ['turismo', 'Magallanes', 'ontología', 'OWL', 'datos enlazados'],
    distribution: grafo.map(([archivo, { tipo }]) => ({ '@type': 'DataDownload', encodingFormat: tipo, contentUrl: `datos/${archivo}` }))
  };

  return html
    .replace(/(<ul class="ficha-enlaces" id="descargas">)[\s\S]*?(<\/ul>)/, (_, antes, fin) =>
      `${antes}${descargas.map(([archivo, { nombre }]) => `<li><a href="datos/${archivo}" download>${esc(nombre)} · ${archivo}</a></li>`).join('')}${fin}`)
    .replace('</head>', () => `${script('application/ld+json', conjunto)}</head>`);
}

// ---------- Complemento

export function publicacion({ fuseki }) {
  let raiz;
  let salida;
  let compilando = false;
  let datos = null; // lo leído de Fuseki al compilar; null si no respondió

  const fuente = (archivo) => readFileSync(resolve(raiz, FUENTES[archivo].origen));

  return {
    name: 'publicacion',

    configResolved(config) {
      raiz = config.root;
      salida = resolve(config.root, config.build.outDir);
      compilando = config.command === 'build';
    },

    // En desarrollo los mismos archivos se sirven al vuelo, para que los enlaces de datos.html funcionen
    configureServer(servidor) {
      servidor.middlewares.use(async (peticion, respuesta, siguiente) => {
        const archivo = (peticion.url ?? '').split('?')[0].match(/^\/datos\/([\w.-]+)$/)?.[1];
        const descrito = FUENTES[archivo] ?? FORMATOS[archivo];
        if (!descrito) return siguiente();
        try {
          const contenido = FUENTES[archivo] ? fuente(archivo) : await volcado(fuseki, descrito.tipo);
          respuesta.setHeader('Content-Type', `${descrito.tipo}; charset=utf-8`);
          respuesta.end(contenido);
        } catch (error) {
          respuesta.statusCode = 503;
          respuesta.setHeader('Content-Type', 'text/plain; charset=utf-8');
          respuesta.end(`No disponible: este formato lo escribe Fuseki y no responde (${error.message}).`);
        }
      });
    },

    async buildStart() {
      if (!compilando) return;
      try {
        datos = await leerFuseki(fuseki);
      } catch (error) {
        datos = null;
        this.warn(`Fuseki no responde en ${fuseki} (${error.message}). No se generan las fichas estáticas, la lista de la portada ni los formatos Turtle y JSON-LD. Inicia Fuseki y vuelve a compilar.`);
      }
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html, { filename }) {
        const pagina = basename(filename);
        if (pagina === 'datos.html') {
          return paginaDatos(html, [...Object.keys(FUENTES), ...(compilando && !datos ? [] : Object.keys(FORMATOS))]);
        }
        if (pagina === 'index.html' && compilando && datos) return paginaIndice(html, datos.atracciones);
        return html;
      }
    },

    // Con el sitio ya escrito: las descargas y una copia de atraccion.html por cada atracción
    writeBundle() {
      mkdirSync(resolve(salida, 'datos'), { recursive: true });
      Object.keys(FUENTES).forEach((archivo) => writeFileSync(resolve(salida, 'datos', archivo), fuente(archivo)));
      if (!datos) return;

      Object.entries(datos.volcados).forEach(([archivo, contenido]) => writeFileSync(resolve(salida, 'datos', archivo), contenido));

      const plantilla = readFileSync(resolve(salida, 'atraccion.html'), 'utf8');
      mkdirSync(resolve(salida, 'ficha'), { recursive: true });
      datos.atracciones.forEach((atraccion) => {
        writeFileSync(resolve(salida, 'ficha', `${atraccion.id}.html`), paginaFicha(plantilla, atraccion, datos));
      });
      console.log(`publicacion: ${datos.atracciones.length} fichas estáticas y ${Object.keys(FUENTES).length + Object.keys(datos.volcados).length} archivos de datos`);
    }
  };
}
