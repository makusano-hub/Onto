import { consultarSPARQL } from './fuseki.js';

const NS = 'http://www.semanticweb.org/usuario/ontologies/2026/9/Ontologia2#';

const PREFIJOS = `
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX t: <${NS}>
`;

// Un lugar es atracción si su clase desciende de alguna de estas raíces.
// La comuna puede estar indicada directamente o a través de la ciudad.
const PATRON_ATRACCION = `
  VALUES ?raiz { t:CulturalHistorico t:ZonaTuristica }
  ?atraccion a ?clase .
  ?clase rdfs:subClassOf* ?raiz .
  OPTIONAL {
    { ?atraccion t:ubicadoEnComuna ?comuna }
    UNION
    { ?atraccion t:ubicadoEnCiudad/t:perteneceAComuna ?comuna }
  }
`;

// Nombre de cada botón de tipo; otra clase nueva usa su propio nombre
const NOMBRES_TIPO = {
  Estatua: 'Monumentos',
  Museo: 'Museos',
  SitioHistorico: 'Sitios históricos',
  Lago: 'Lagos',
  Montaña: 'Montañas',
  Parque: 'Parques',
  Reserva: 'Reservas',
  Rio: 'Ríos'
};

// Nombre del botón de cada modelo cuando una atracción tiene varios; otro archivo usa su propio nombre
const NOMBRES_MODELO = {
  'modelos3d/nao_victoria_model.glb': 'Nao Victoria',
  'modelos3d/hms_beagle_model.glb': 'HMS Beagle',
  'modelos3d/goleta_ancud_model.glb': 'Goleta Ancud'
};

// Solo se aceptan identificadores simples, para que un valor de la dirección no altere la consulta
const ID_VALIDO = /^[\p{L}\p{N}_-]+$/u;

function idDe(uri) {
  return uri.split('#').pop();
}

function iri(id) {
  if (!ID_VALIDO.test(id)) throw new Error(`Identificador no válido: ${id}`);
  return `<${NS}${id}>`;
}

// Convierte "PuertoHambre" o "Isla_Magdalena" en un nombre legible
function nombreLegible(id) {
  const texto = id
    .replace(/_/g, ' ')
    .replace(/([a-zñ])([A-Z])/g, '$1 $2')
    .replace(/\s(De|Del|La|Las|Los)\s/g, (conector) => conector.toLowerCase());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function nombreTipo(clase) {
  return NOMBRES_TIPO[clase] ?? nombreLegible(clase);
}

function ordenarPorNombre(opciones) {
  return opciones.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// Botones de comuna y de tipo: solo los que tienen alguna atracción
export async function obtenerFiltros() {
  const [comunas, tipos] = await Promise.all([
    consultarSPARQL(`${PREFIJOS}
      SELECT DISTINCT ?comuna WHERE {
        ${PATRON_ATRACCION}
        FILTER(BOUND(?comuna))
      }
    `),
    consultarSPARQL(`${PREFIJOS}
      SELECT DISTINCT ?clase WHERE {
        ${PATRON_ATRACCION}
      }
    `)
  ]);

  return {
    comuna: ordenarPorNombre(comunas.map(({ comuna }) => ({
      id: idDe(comuna),
      nombre: nombreLegible(idDe(comuna))
    }))),
    tipo: ordenarPorNombre(tipos.map(({ clase }) => ({
      id: idDe(clase),
      nombre: nombreTipo(idDe(clase))
    })))
  };
}

export function buscarAtracciones({ comuna, tipo }) {
  return consultarAtracciones(`
    ${comuna ? `FILTER(?comuna = ${iri(comuna)})` : ''}
    ${tipo ? `FILTER(?clase = ${iri(tipo)})` : ''}
  `);
}

export async function obtenerAtraccion(id) {
  if (!ID_VALIDO.test(id ?? '')) return null;

  const [atraccion] = await consultarAtracciones(`FILTER(?atraccion = ${iri(id)})`);
  return atraccion ?? null;
}

async function consultarAtracciones(filtros) {
  const filas = await consultarSPARQL(`${PREFIJOS}
    SELECT ?atraccion ?clase ?comuna ?nombre ?descripcion ?calificacion
           ?precio ?requierePermiso ?tieneTemporada
           (GROUP_CONCAT(DISTINCT ?modelo; SEPARATOR="|") AS ?modelos)
    WHERE {
      ${PATRON_ATRACCION}
      OPTIONAL { ?atraccion t:Nombre ?nombre }
      OPTIONAL { ?atraccion t:Descripcion ?descripcion }
      OPTIONAL { ?atraccion t:Calificacion ?calificacion }
      OPTIONAL { ?atraccion t:Precio ?precio }
      OPTIONAL { ?atraccion t:requierePermisoAutoridad ?requierePermiso }
      OPTIONAL { ?atraccion t:tieneTemporada ?tieneTemporada }
      OPTIONAL { ?atraccion t:tieneModelo3D ?modelo }
      ${filtros}
    }
    GROUP BY ?atraccion ?clase ?comuna ?nombre ?descripcion ?calificacion
             ?precio ?requierePermiso ?tieneTemporada
  `);

  return filas
    .map(crearAtraccion)
    // Primero las que ya tienen modelo 3D
    .sort((a, b) => (b.modelos.length > 0) - (a.modelos.length > 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

function crearAtraccion(fila) {
  const id = idDe(fila.atraccion);
  const nombre = fila.nombre ?? nombreLegible(id);

  return {
    id,
    uri: fila.atraccion,
    nombre,
    tipo: nombreTipo(idDe(fila.clase)),
    comuna: fila.comuna ? nombreLegible(idDe(fila.comuna)) : null,
    descripcion: fila.descripcion ?? '',
    calificacion: fila.calificacion ?? null,
    precio: fila.precio ?? null,
    requierePermiso: fila.requierePermiso ?? null,
    tieneTemporada: fila.tieneTemporada ?? null,
    modelos: crearModelos(fila.modelos, nombre)
  };
}

function crearModelos(modelos, nombreAtraccion) {
  // Una atracción sin modelos no trae este valor en la respuesta
  const rutas = modelos?.split('|') ?? [];

  return rutas
    .map((ruta) => ({
      // Un modelo único se llama igual que su atracción
      nombre: rutas.length > 1 ? nombreModelo(ruta) : nombreAtraccion,
      ruta: `${import.meta.env.BASE_URL}${ruta}`
    }))
    // Primero el modelo que da nombre a la atracción
    .sort((a, b) => nombreAtraccion.includes(b.nombre) - nombreAtraccion.includes(a.nombre) || a.nombre.localeCompare(b.nombre, 'es'));
}

function nombreModelo(ruta) {
  return NOMBRES_MODELO[ruta] ?? nombreLegible(ruta.split('/').pop().replace(/\.\w+$/, ''));
}
