// Complemento de Vite que publica los datos: deja en el sitio compilado lo que una máquina
// puede leer sin ejecutar JavaScript ni consultar Fuseki.
//
//   datos/turismo.rdf, .ttl y .jsonld   el grafo para descargar, más las reglas SHACL
//   datos/turismo-inferido.ttl          el grafo con lo que deduce el razonador de Fuseki
//   datos/informe-shacl.nt              el resultado de validar el grafo con las reglas SHACL
//   ficha/<id>.html                     una página por atracción con su JSON-LD y sus datos incrustados
//   index.html                          la lista de atracciones ya escrita, con enlaces a esas fichas
//   datos.html                          la descripción del conjunto de datos (schema:Dataset)
//   ontologia/                          el documento del vocabulario: a él llevan los IRIs de la ontología
//   sitemap.xml                         las páginas publicadas, con su dirección definitiva
//
// Las fichas, la lista, el vocabulario y los formatos Turtle y JSON-LD salen de Fuseki: tiene que estar
// en marcha al compilar. Sin Fuseki la compilación termina igual, solo con turismo.rdf y las reglas SHACL.
//
// El sitio publicado no tiene Fuseki: allí las consultas las responde el navegador (js/motor-local.js) sobre
// datos/turismo.rdf. Lo que el navegador no sabe calcular (la inferencia y la validación SHACL) lo calcula
// Fuseki aquí, al compilar, y se publica como dos archivos más.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { SITIO, NS, SCHEMA, nombreLegible } from '../js/catalogo.js';

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

// Lo que Fuseki calcula a partir del grafo. Si este Fuseki no tiene el servicio (no se inició con
// fuseki/config.ttl), el archivo no se publica y la compilación avisa.
const DERIVADOS = {
  'turismo-inferido.ttl': {
    tipo: 'text/turtle',
    nombre: 'Grafo con inferencia (Turtle)',
    servicio: '/turismo-inferido',
    // El servicio con razonador solo admite consultas: el grafo entero se pide con un CONSTRUCT
    leer: (fuseki) => fetch(`${fuseki}/turismo-inferido/query?${new URLSearchParams({ query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }' })}`, {
      headers: { Accept: 'text/turtle' }
    })
  },
  'informe-shacl.nt': {
    tipo: 'application/n-triples',
    nombre: 'Informe de validación SHACL (N-Triples)',
    servicio: '/turismo/shacl',
    // La misma petición que hace js/shacl.js desde el panel
    leer: (fuseki, reglas) => fetch(`${fuseki}/turismo/shacl?graph=default`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/turtle', Accept: 'application/n-triples' },
      body: reglas
    })
  }
};

// Páginas con dirección propia: ruta del archivo -> ruta pública (para el enlace canónico y el sitemap).
// atraccion.html y panel.html no están: una depende de ?id= y el otro es una herramienta interna.
const PAGINAS = { 'index.html': '', 'datos.html': 'datos.html', 'grafo.html': 'grafo.html', 'ontologia/index.html': 'ontologia/' };

// Licencia de los datos: la misma que declara la ontología (dcterms:license) y que muestra datos.html
const LICENCIA = 'https://creativecommons.org/licenses/by/4.0/';

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const DCT = 'http://purl.org/dc/terms/';
const WIKIDATA = 'http://www.wikidata.org/entity/';

const esc = (texto) => String(texto).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// JSON dentro de <script>: "<" escapado para que ningún texto pueda cerrar la etiqueta
const incrustar = (tipo, json, id) => `<script type="${tipo}"${id ? ` id="${id}"` : ''}>${json.replace(/</g, '\\u003c')}</script>\n`;
const script = (tipo, datos, id) => incrustar(tipo, JSON.stringify(datos), id);

const canonico = (ruta) => `<link rel="canonical" href="${SITIO}${ruta}">\n`;
const rutaFicha = (id) => `ficha/${encodeURIComponent(id)}.html`;

// Sustituye una parte de una página y falla si no la encuentra: si alguien cambia el marcado,
// la compilación se detiene en vez de publicar una página a medias sin avisar.
// "reemplazo" es una función: en un texto de reemplazo, "$1" de un precio se leería como un grupo.
function sustituir(html, patron, reemplazo, descripcion) {
  let hecho = false;
  const resultado = html.replace(patron, (...partes) => {
    hecho = true;
    return reemplazo(...partes);
  });
  if (!hecho) throw new Error(`publicacion: no se encontró ${descripcion}. Revisa el marcado de la página o el patrón en scripts/publicacion.mjs.`);
  return resultado;
}

// Bloque con un id: su etiqueta de apertura (con los atributos que tenga), su contenido y su cierre
const bloque = (etiqueta, id) => new RegExp(`(<${etiqueta}\\b[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(</${etiqueta}>)`);

// ---------- Lectura de Fuseki, con las mismas consultas y funciones que usa el sitio

async function volcado(fuseki, tipo) {
  const respuesta = await fetch(`${fuseki}/turismo/get?default`, { headers: { Accept: tipo } });
  if (!respuesta.ok) throw new Error(`Fuseki respondió ${respuesta.status} al pedir ${tipo}`);
  return respuesta.text();
}

async function leerAtracciones(fuseki) {
  const { obtenerInventario } = await import('../js/ontologia.js');
  return obtenerInventario(`${fuseki}/turismo/query`);
}

// Términos propios de la ontología: { id, p: { IRI de la propiedad: [valores] } }
async function leerTerminos(fuseki) {
  const { consultarSPARQLDetallado } = await import('../js/fuseki.js');
  const { construir } = await import('../js/consultas.js');
  const { filas } = await consultarSPARQLDetallado(construir.vocabulario(), `${fuseki}/turismo/query`);

  const terminos = new Map();
  filas.forEach(({ termino, propiedad, valor }) => {
    const id = termino.value.slice(NS.length);
    if (!terminos.has(id)) terminos.set(id, { id, p: {} });
    (terminos.get(id).p[propiedad.value] ||= []).push(valor);
  });

  // Lo que cuelga de nodos anónimos: condiciones necesarias de las clases y dominios que son una unión
  const { filas: axiomas } = await consultarSPARQLDetallado(construir.axiomas(), `${fuseki}/turismo/query`);
  axiomas.forEach(({ termino, axioma, propiedad, valor }) => {
    const descrito = terminos.get(termino.value.slice(NS.length));
    if (!descrito) return;
    if (axioma.value === 'condicion') (descrito.condiciones ||= []).push({ propiedad: propiedad.value, valor: valor.value });
    else (descrito.dominio ||= []).push(valor.value);
  });

  return [...terminos.values()].sort((a, b) => a.id.localeCompare(b.id, 'es'));
}

// Versión y fechas que la ontología declara en su cabecera: { version, creada, modificada }
async function leerCabecera(fuseki) {
  const { consultarSPARQL } = await import('../js/fuseki.js');
  const { construir } = await import('../js/consultas.js');
  const filas = await consultarSPARQL(construir.cabecera(), `${fuseki}/turismo/query`);
  const valor = (propiedad) => filas.find((fila) => fila.propiedad === propiedad)?.valor ?? null;
  return { version: valor(`${OWL}versionInfo`), creada: valor(`${DCT}created`), modificada: valor(`${DCT}modified`) };
}

async function derivado(fuseki, archivo, reglas) {
  const { leer, servicio } = DERIVADOS[archivo];
  const respuesta = await leer(fuseki, reglas);
  if (!respuesta.ok) throw new Error(`Fuseki respondió ${respuesta.status} en ${servicio}`);
  return respuesta.text();
}

async function leerFuseki(fuseki, reglas) {
  const { CAMPOS, datosEstructurados } = await import('../js/ficha-datos.js');
  const atracciones = await leerAtracciones(fuseki);
  if (!atracciones.length) throw new Error('el dataset turismo no tiene atracciones');

  const volcados = {};
  for (const [archivo, { tipo }] of Object.entries(FORMATOS)) volcados[archivo] = await volcado(fuseki, tipo);

  // Un Fuseki sin razonador o sin SHACL no impide publicar el resto
  const derivados = {};
  const sinDerivar = [];
  for (const archivo of Object.keys(DERIVADOS)) {
    try {
      derivados[archivo] = await derivado(fuseki, archivo, reglas);
    } catch (error) {
      sinDerivar.push(`${archivo} (${error.message})`);
    }
  }

  return {
    atracciones, volcados, derivados, sinDerivar,
    terminos: await leerTerminos(fuseki), cabecera: await leerCabecera(fuseki), CAMPOS, datosEstructurados
  };
}

// ---------- Páginas

function paginaFicha(plantilla, atraccion, { CAMPOS, datosEstructurados }) {
  const { id, nombre, tipo, comuna, descripcion, enlaces, equivalentes } = atraccion;
  const campos = CAMPOS.map(([, etiqueta, valor]) => [etiqueta, valor(atraccion)]).filter(([, texto]) => texto);
  const vinculos = [...enlaces, ...equivalentes];
  // Con la dirección del sitio, las rutas de modelos e imágenes del JSON-LD quedan completas
  const estructurados = { ...datosEstructurados(atraccion, SITIO), url: `${SITIO}${rutaFicha(id)}` };

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

  let html = plantilla;
  // La ficha vive en ficha/: con <base> sus rutas (estilos, modelos, enlaces) se resuelven como en la raíz
  html = sustituir(html, '<head>', () => '<head>\n\t<base href="../">', '<head> en atraccion.html');
  html = sustituir(html, /<title>[\s\S]*?<\/title>/, () => `<title>${esc(nombre)} | Atracciones turísticas de Magallanes</title>`, '<title> en atraccion.html');
  html = sustituir(html, /(<meta name="description" content=")[^"]*(")/, (_, antes, despues) =>
    `${antes}${esc(descripcion || `${nombre}: ${tipo} de la Región de Magallanes.`)}${despues}`, '<meta name="description"> en atraccion.html');
  html = sustituir(html, '</head>', () => `${canonico(rutaFicha(id))}${script('application/ld+json', estructurados)}${script('application/json', atraccion, 'datos-atraccion')}</head>`, '</head> en atraccion.html');
  return sustituir(html, bloque('div', 'ficha'), (_, antes, despues) => `${antes}${cuerpo}${despues}`, '<div id="ficha"> en atraccion.html');
}

function paginaIndice(html, atracciones) {
  const tarjetas = atracciones.map(({ id, nombre, tipo, comuna, modelos }) => `
				<li><a class="card tarjeta-atraccion" href="${rutaFicha(id)}"><h3>${esc(nombre)}</h3><p>${esc(comuna ? `${tipo} · ${comuna}` : tipo)}</p>${
  modelos.length ? `<span class="etiqueta-3d">${modelos.length > 1 ? `${modelos.length} modelos 3D` : 'Modelo 3D'}</span>` : ''}</a></li>`).join('');

  const lista = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Atracciones turísticas de la Región de Magallanes',
    numberOfItems: atracciones.length,
    itemListElement: atracciones.map(({ id, nombre }, indice) => ({
      '@type': 'ListItem', position: indice + 1, name: nombre, url: `${SITIO}${rutaFicha(id)}`
    }))
  };

  let resultado = html;
  // data-estatica: js/inicio.js conserva esta lista si Fuseki no responde
  resultado = sustituir(resultado, bloque('ul', 'lista-atracciones'), (_, antes, fin) =>
    `${antes.replace(/>$/, ' data-estatica>')}${tarjetas}\n\t\t\t${fin}`, '<ul id="lista-atracciones"> en index.html');
  resultado = sustituir(resultado, bloque('p', 'total-atracciones'), (_, antes, fin) =>
    `${antes}${atracciones.length} atracciones${fin}`, '<p id="total-atracciones"> en index.html');
  return sustituir(resultado, '</head>', () => `${script('application/ld+json', lista)}</head>`, '</head> en index.html');
}

// datos.html: solo enlaza los archivos que existen y describe el conjunto con schema:Dataset
function paginaDatos(html, disponibles, cabecera) {
  const descargas = Object.entries({ ...FUENTES, ...FORMATOS, ...DERIVADOS }).filter(([archivo]) => disponibles.includes(archivo));
  // Distribuciones del conjunto de datos: solo el grafo declarado, en sus formatos
  const grafo = descargas.filter(([archivo]) => archivo !== 'turismo.shacl.ttl' && !(archivo in DERIVADOS));

  const conjunto = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': `${SITIO}ontologia`,
    name: 'Ontología de turismo de la Región de Magallanes',
    description: 'Lugares, actividades, ciudades y comunas de la Región de Magallanes y de la Antártica Chilena, con sus modelos 3D, enlazados con Wikidata y alineados con schema.org.',
    url: `${SITIO}datos.html`,
    inLanguage: 'es',
    license: LICENCIA,
    // De la cabecera de la ontología (owl:versionInfo, dcterms:created y dcterms:modified); sin ella no se escriben
    version: cabecera?.version ?? undefined,
    dateCreated: cabecera?.creada ?? undefined,
    dateModified: cabecera?.modificada ?? undefined,
    keywords: ['turismo', 'Magallanes', 'ontología', 'OWL', 'datos enlazados'],
    distribution: grafo.map(([archivo, { tipo }]) => ({ '@type': 'DataDownload', encodingFormat: tipo, contentUrl: `${SITIO}datos/${archivo}` }))
  };

  const conDescargas = sustituir(html, bloque('ul', 'descargas'), (_, antes, fin) =>
    `${antes}${descargas.map(([archivo, { nombre }]) => `<li><a href="datos/${archivo}" download>${esc(nombre)} · ${archivo}</a></li>`).join('')}${fin}`,
  '<ul id="descargas"> en datos.html');
  return sustituir(conDescargas, '</head>', () => `${script('application/ld+json', conjunto)}</head>`, '</head> en datos.html');
}

// ontologia/: el documento al que llevan los IRIs. Cada término tiene un ancla con su identificador,
// así <SITIO>ontologia#FuerteBulnes abre la página en ese individuo; el grafo completo va incrustado en JSON-LD.
function paginaVocabulario(html, { terminos, jsonld, enlaceFicha, cabecera }) {
  const DONDE = '<div id="terminos"> en ontologia/index.html';
  if (!terminos) {
    return sustituir(html, bloque('div', 'terminos'), (_, antes, fin) =>
      `${antes}<p>La lista de términos se escribe con Fuseki en marcha. El grafo completo está en <a href="../datos/turismo.rdf">turismo.rdf</a>.</p>${fin}`, DONDE);
  }

  const porId = new Map(terminos.map((termino) => [termino.id, termino]));
  const iris = (termino, propiedad) => (termino.p[propiedad] ?? []).filter(({ type }) => type === 'uri').map(({ value }) => value);
  const texto = (termino, propiedad) => (termino.p[propiedad] ?? []).find(({ type }) => type !== 'uri')?.value;
  const es = (termino, clase) => iris(termino, `${RDF}type`).includes(`${OWL}${clase}`);
  const etiqueta = (id) => {
    const termino = porId.get(id);
    return (termino && (texto(termino, `${RDFS}label`) ?? texto(termino, `${NS}Nombre`))) ?? nombreLegible(id);
  };

  const referencia = (iri) => {
    if (iri.startsWith(NS)) return `<a href="#${encodeURIComponent(iri.slice(NS.length))}">${esc(etiqueta(iri.slice(NS.length)))}</a>`;
    if (iri.startsWith(SCHEMA)) return `<a href="${esc(iri)}">schema:${esc(iri.slice(SCHEMA.length))}</a>`;
    if (iri.startsWith(WIKIDATA)) return `<a href="${esc(iri)}">Wikidata ${esc(iri.slice(WIKIDATA.length))}</a>`;
    if (iri.startsWith(XSD)) return `xsd:${esc(iri.slice(XSD.length))}`;
    if (iri === `${RDF}PlainLiteral`) return 'texto, con o sin idioma (rdf:PlainLiteral)';
    return `<a href="${esc(iri)}">${esc(iri)}</a>`;
  };
  // "Etiqueta: a, b" con los valores de una propiedad; vacío si no tiene (o solo apunta a términos de OWL)
  const relacion = (nombre, termino, propiedad) => {
    const valores = iris(termino, propiedad).filter((iri) => !iri.startsWith(OWL));
    return valores.length ? `${nombre}: ${valores.map(referencia).join(', ')}` : '';
  };
  const fila = (termino, detalles) => `
			<li id="${esc(termino.id)}"><span><strong>${esc(etiqueta(termino.id))}</strong> <code>t:${esc(termino.id)}</code></span>${
  detalles.filter(Boolean).map((detalle) => `<small>${detalle}</small>`).join('')}</li>`;
  const seccion = (titulo, filas) => `
		<h2 class="titulo-seccion">${titulo} (${filas.length})</h2>
		<ul class="lista-terminos">${filas.join('')}
		</ul>`;

  // "Etiqueta: a, b" con una lista de IRIs ya reunida; como alternativas se escribe "a, b o c"
  const unaUOtra = new Intl.ListFormat('es', { type: 'disjunction' });
  const lista =(nombre, valores, unir = (partes) => partes.join(', ')) => (valores.length ? `${nombre}: ${unir(valores.map(referencia))}` : '');

  // owl:disjointWith se declara en un solo sentido (A disjunta con B); aquí se muestra en las dos clases
  const disjuntas = new Map();
  terminos.forEach((termino) => iris(termino, `${OWL}disjointWith`).forEach((otra) => {
    [[`${NS}${termino.id}`, otra], [otra, `${NS}${termino.id}`]].forEach(([una, con]) => {
      if (!disjuntas.has(una)) disjuntas.set(una, new Set());
      disjuntas.get(una).add(con);
    });
  }));

  const clases = terminos.filter((termino) => es(termino, 'Class')).map((termino) => fila(termino, [
    [
      relacion('Subclase de', termino, `${RDFS}subClassOf`),
      lista('Disjunta con', [...(disjuntas.get(`${NS}${termino.id}`) ?? [])].sort())
    ].filter(Boolean).join(' · '),
    // Condición necesaria (owl:someValuesFrom): todo individuo de la clase tiene esa propiedad hacia alguno de esa otra
    (termino.condiciones ?? []).map(({ propiedad, valor }) => `Condición necesaria: ${referencia(propiedad)} → ${referencia(valor)}`).join(' · ')
  ]));

  const propiedades = terminos.filter((termino) => es(termino, 'ObjectProperty') || es(termino, 'DatatypeProperty')).map((termino) => fila(termino, [
    esc(texto(termino, `${RDFS}comment`) ?? ''),
    [
      es(termino, 'ObjectProperty') ? 'Relaciona dos individuos' : 'Tiene un valor',
      es(termino, 'FunctionalProperty') ? 'Funcional (un solo valor)' : '',
      es(termino, 'TransitiveProperty') ? 'Transitiva' : '',
      // El dominio es una clase o, si la propiedad se aplica a varias, la unión de ellas
      relacion('Dominio', termino, `${RDFS}domain`) || lista('Dominio', [...(termino.dominio ?? [])].sort(), (partes) => unaUOtra.format(partes)),
      relacion('Rango', termino, `${RDFS}range`),
      relacion('Inversa de', termino, `${OWL}inverseOf`),
      relacion('Subpropiedad de', termino, `${RDFS}subPropertyOf`)
    ].filter(Boolean).join(' · ')
  ]));

  const individuos = terminos.filter((termino) => es(termino, 'NamedIndividual')).map((termino) => fila(termino, [
    [
      relacion('Tipo', termino, `${RDF}type`),
      relacion('Mismo que', termino, `${OWL}sameAs`),
      enlaceFicha(termino.id) ? `<a href="${esc(enlaceFicha(termino.id))}">Ver ficha</a>` : ''
    ].filter(Boolean).join(' · ')
  ]));

  const alternativas = Object.entries({ ...FUENTES, ...FORMATOS }).filter(([archivo]) => archivo !== 'turismo.shacl.ttl')
    .map(([archivo, { tipo }]) => `<link rel="alternate" type="${tipo}" href="../datos/${archivo}">\n`).join('');

  const fecha = (valor) => `<time datetime="${esc(valor)}">${esc(valor)}</time>`;
  const version = [
    cabecera?.version ? `Versión ${esc(cabecera.version)}` : '',
    cabecera?.creada ? `creada el ${fecha(cabecera.creada)}` : '',
    cabecera?.modificada ? `última modificación el ${fecha(cabecera.modificada)}` : ''
  ].filter(Boolean).join(' · ');

  const conTerminos = sustituir(html, bloque('div', 'terminos'), (_, antes, fin) =>
    `${antes}${version ? `\n\t\t<p class="version-ontologia">${version}</p>` : ''}${seccion('Clases', clases)}${seccion('Propiedades', propiedades)}${seccion('Individuos', individuos)}\n\t\t${fin}`, DONDE);
  return sustituir(conTerminos, '</head>', () => `${alternativas}${jsonld ? incrustar('application/ld+json', jsonld) : ''}</head>`, '</head> en ontologia/index.html');
}

// Modelos de modelos3d/ que no se publican: los que ningún individuo usa y los originales en un formato
// que el visor no abre. Siguen en public/ para trabajar con ellos; solo se quitan del sitio compilado,
// donde alargaban cada despliegue sin que ninguna página los cargara.
const ARCHIVO_MODELO = /\.(glb|gltf|fbx|obj|blend)$/i;

function retirarModelosSinUso(salida, { atracciones, terminos }) {
  const carpeta = resolve(salida, 'modelos3d');
  if (!existsSync(carpeta)) return [];

  const enUso = new Set([
    ...atracciones.flatMap(({ crudo }) => crudo.modelos),
    ...terminos.flatMap(({ p }) => (p[`${NS}tieneModelo3D`] ?? []).map(({ value }) => value))
  ].map((ruta) => ruta.split('?')[0].replace(/^\/+/, '')));

  return readdirSync(carpeta, { withFileTypes: true })
    .filter((entrada) => entrada.isFile() && ARCHIVO_MODELO.test(entrada.name) && !enUso.has(`modelos3d/${entrada.name}`))
    .map(({ name }) => {
      const ruta = resolve(carpeta, name);
      const { size } = statSync(ruta);
      rmSync(ruta);
      return { nombre: name, size };
    });
}

function sitemap(atracciones) {
  const rutas = [...Object.values(PAGINAS), ...atracciones.map(({ id }) => rutaFicha(id))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rutas.map((ruta) => `  <url><loc>${esc(SITIO + ruta)}</loc></url>`).join('\n')}
</urlset>
`;
}

// ---------- Complemento

export function publicacion({ fuseki }) {
  let raiz;
  let salida;
  let compilando = false;
  let datos = null; // lo leído de Fuseki al compilar; null si no respondió

  const fuente = (archivo) => readFileSync(resolve(raiz, FUENTES[archivo].origen));

  // El vocabulario se escribe igual al compilar y en desarrollo; en desarrollo se pide a Fuseki en cada visita
  async function vocabulario(html) {
    if (compilando) {
      if (!datos) return paginaVocabulario(html, {});
      const conFicha = new Set(datos.atracciones.map(({ id }) => id));
      return paginaVocabulario(html, {
        terminos: datos.terminos,
        cabecera: datos.cabecera,
        jsonld: datos.volcados['turismo.jsonld'],
        enlaceFicha: (id) => (conFicha.has(id) ? `../${rutaFicha(id)}` : null)
      });
    }
    try {
      const conFicha = new Set((await leerAtracciones(fuseki)).map(({ id }) => id));
      return paginaVocabulario(html, {
        terminos: await leerTerminos(fuseki),
        cabecera: await leerCabecera(fuseki),
        jsonld: await volcado(fuseki, FORMATOS['turismo.jsonld'].tipo),
        enlaceFicha: (id) => (conFicha.has(id) ? `../atraccion.html?id=${encodeURIComponent(id)}` : null)
      });
    } catch {
      return paginaVocabulario(html, {});
    }
  }

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
        const descrito = FUENTES[archivo] ?? FORMATOS[archivo] ?? DERIVADOS[archivo];
        if (!descrito) return siguiente();
        try {
          const contenido = FUENTES[archivo] ? fuente(archivo)
            : DERIVADOS[archivo] ? await derivado(fuseki, archivo, fuente('turismo.shacl.ttl'))
              : await volcado(fuseki, descrito.tipo);
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
        datos = await leerFuseki(fuseki, fuente('turismo.shacl.ttl'));
        if (datos.sinDerivar.length) {
          this.warn(`Este Fuseki no ofrece la inferencia o la validación SHACL: no se publica ${datos.sinDerivar.join(' ni ')}. Sin esos archivos, el panel del sitio publicado no tendrá "Con inferencia" ni las reglas SHACL. Inicia Fuseki con fuseki/config.ttl y vuelve a compilar.`);
        }
      } catch (error) {
        datos = null;
        this.warn(`Fuseki no responde en ${fuseki} (${error.message}). No se generan las fichas estáticas, la lista de la portada, el vocabulario ni los formatos Turtle y JSON-LD. Inicia Fuseki y vuelve a compilar.`);
      }
    },

    // "post": lo que se escribe aquí queda tal cual, sin que Vite intente resolver sus enlaces
    transformIndexHtml: {
      order: 'post',
      async handler(html, { filename }) {
        const pagina = relative(raiz, filename).replace(/\\/g, '/');
        let resultado = html;
        if (pagina === 'datos.html') {
          // En desarrollo se enlazan todos: los que escribe Fuseki se piden al abrirlos
          const deFuseki = !compilando ? [...Object.keys(FORMATOS), ...Object.keys(DERIVADOS)]
            : datos ? [...Object.keys(FORMATOS), ...Object.keys(datos.derivados)] : [];
          // La versión sale de Fuseki: en desarrollo se pide al abrir la página y, si no responde, no se escribe
          const cabecera = compilando ? datos?.cabecera : await leerCabecera(fuseki).catch(() => null);
          resultado = paginaDatos(html, [...Object.keys(FUENTES), ...deFuseki], cabecera);
        } else if (pagina === 'ontologia/index.html') {
          resultado = await vocabulario(html);
        } else if (pagina === 'index.html' && compilando && datos) {
          resultado = paginaIndice(html, datos.atracciones);
        }
        // El enlace canónico solo tiene sentido en el sitio publicado
        return compilando && pagina in PAGINAS
          ? sustituir(resultado, '</head>', () => `${canonico(PAGINAS[pagina])}</head>`, `</head> en ${pagina}`)
          : resultado;
      }
    },

    // Con el sitio ya escrito: las descargas, el sitemap y una copia de atraccion.html por cada atracción
    writeBundle() {
      mkdirSync(resolve(salida, 'datos'), { recursive: true });
      Object.keys(FUENTES).forEach((archivo) => writeFileSync(resolve(salida, 'datos', archivo), fuente(archivo)));
      writeFileSync(resolve(salida, 'sitemap.xml'), sitemap(datos?.atracciones ?? []));
      if (!datos) return;

      Object.entries({ ...datos.volcados, ...datos.derivados }).forEach(([archivo, contenido]) => writeFileSync(resolve(salida, 'datos', archivo), contenido));

      const plantilla = readFileSync(resolve(salida, 'atraccion.html'), 'utf8');
      mkdirSync(resolve(salida, 'ficha'), { recursive: true });
      datos.atracciones.forEach((atraccion) => {
        writeFileSync(resolve(salida, 'ficha', `${atraccion.id}.html`), paginaFicha(plantilla, atraccion, datos));
      });
      console.log(`publicacion: ${datos.atracciones.length} fichas estáticas, ${datos.terminos.length} términos en el vocabulario y ${Object.keys(FUENTES).length + Object.keys(datos.volcados).length + Object.keys(datos.derivados).length} archivos de datos`);

      const retirados = retirarModelosSinUso(salida, datos);
      if (retirados.length) {
        const megas = Math.round(retirados.reduce((suma, { size }) => suma + size, 0) / 1024 / 1024);
        console.log(`publicacion: ${retirados.length} modelos sin uso no se publican (${megas} MB): ${retirados.map(({ nombre }) => nombre).join(', ')}`);
      }
    }
  };
}
