// Convierte las respuestas SPARQL (de Fuseki o del motor del navegador) en objetos que usan las páginas
import { consultarSPARQL } from './fuseki.js';
import { construir, SEP } from './consultas.js';
import {
  CATEGORIAS, NS, ID_VALIDO, NOMBRES_MODELO, RAIZ_ACTIVIDAD,
  idDe, nombreLegible, nombreClase, nombreSitio, categoriaPorId, rutaPublica, esEnlaceWeb, esVerdadero
} from './catalogo.js';

function ordenarPorNombre(opciones) {
  return opciones.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function validarId(id) {
  if (!ID_VALIDO.test(id)) throw new Error(`Identificador no válido: ${id}`);
  return id;
}

// Botones de comuna (solo las que tienen atracciones) y de categoría (todas, con su total)
export async function obtenerFiltros() {
  const [comunas, totales] = await Promise.all([
    consultarSPARQL(construir.comunas()),
    consultarSPARQL(construir.categorias())
  ]);

  const totalPorCategoria = Object.fromEntries(totales.map(({ categoria, total }) => [categoria, Number(total)]));

  return {
    comuna: ordenarPorNombre(comunas.map(({ comuna, total }) => ({
      id: idDe(comuna),
      nombre: nombreLegible(idDe(comuna)),
      total: Number(total)
    }))),
    categoria: CATEGORIAS.map(({ id, nombre, portada, unidad = ['lugar', 'lugares'] }) => ({
      id, nombre, portada: Boolean(portada), unidad, total: totalPorCategoria[id] ?? 0
    }))
  };
}

// Ciudades con coordenadas, para el mapa de la portada: { id, nombre, latitud, longitud }
export async function obtenerCiudades() {
  const filas = await consultarSPARQL(construir.ciudadesMapa());
  return filas
    .map(({ ciudad, nombre, latitud, longitud }) => ({
      id: idDe(ciudad),
      nombre: nombre || nombreLegible(idDe(ciudad)),
      latitud: Number(latitud),
      longitud: Number(longitud)
    }))
    .filter(({ latitud, longitud }) => Number.isFinite(latitud) && Number.isFinite(longitud));
}

export async function buscarAtracciones({ comuna, categoria }) {
  const filas = await consultarSPARQL(construir.busqueda({
    comuna: comuna ? validarId(comuna) : '',
    categoria: categoria ? categoriaPorId(categoria) : null
  }));
  return ordenar(filas.map(crearAtraccion));
}

// "endpoint" permite consultar Fuseki por su dirección completa (al compilar no hay proxy de Vite)
export async function obtenerInventario(endpoint) {
  const filas = await consultarSPARQL(construir.inventario(), endpoint);
  return ordenar(filas.map(crearAtraccion));
}

export async function obtenerAtraccion(id) {
  if (!ID_VALIDO.test(id ?? '')) return null;

  const [fila] = await consultarSPARQL(construir.ficha(id));
  return fila ? crearAtraccion(fila) : null;
}

// Primero las que ya tienen modelo 3D
function ordenar(atracciones) {
  return atracciones.sort((a, b) =>
    (b.modelos.length > 0) - (a.modelos.length > 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

// Ordenada: GROUP_CONCAT no garantiza un orden, y Fuseki y el motor del navegador devolvían los mismos
// valores en orden distinto (una ficha compilada y la misma ficha en vivo mostraban "A / B" y "B / A")
const lista = (valor) => (valor ? valor.split(SEP).filter(Boolean).sort() : []);
const nombres = (uris) => uris.map((uri) => nombreLegible(idDe(uri)));

// Objeto de atracción. Conserva los valores en bruto (crudo) para que la validación pueda revisarlos.
export function crearAtraccion(fila) {
  const id = idDe(fila.atraccion);
  const crudo = {
    clases: lista(fila.clases),
    nombres: lista(fila.nombres),
    descripciones: lista(fila.descripciones),
    calificaciones: lista(fila.calificaciones),
    precios: lista(fila.precios),
    modelos: lista(fila.modelos),
    imagenes: lista(fila.imagenes),
    enlaces: lista(fila.enlaces),
    lugares: lista(fila.lugares),
    ciudades: lista(fila.ciudades),
    comunas: lista(fila.comunas)
  };

  const nombre = crudo.nombres[0] ?? nombreLegible(id);
  const clases = crudo.clases.map(idDe);
  // "true" o "false", se escriba como se escriba en la ontología; null si no tiene el dato
  const booleano = (valor) => (valor == null ? null : String(esVerdadero(valor)));

  return {
    id,
    uri: fila.atraccion,
    enEspacioPrincipal: fila.atraccion.startsWith(NS),
    nombre,
    clases,
    // Una actividad no lleva modelo 3D ni ubicación propia: la ficha y la portada lo tienen en cuenta
    esActividad: lista(fila.raices).map(idDe).includes(RAIZ_ACTIVIDAD),
    tipo: clases.map(nombreClase).join(' / '),
    ciudad: nombres(crudo.ciudades).join(', ') || null,
    comuna: nombres(crudo.comunas).join(', ') || null,
    comunaIds: crudo.comunas.map(idDe),
    lugar: nombres(crudo.lugares).join(', ') || null,
    lugarIds: crudo.lugares.map(idDe),
    descripcion: crudo.descripciones[0] ?? '',
    calificacion: crudo.calificaciones[0] ?? null,
    precio: crudo.precios[0] ?? null,
    requierePermiso: booleano(fila.requierePermiso),
    tieneTemporada: booleano(fila.tieneTemporada),
    modelos: crearModelos(crudo.modelos, nombre),
    imagenes: crudo.imagenes.map((ruta) => ({ ruta: rutaPublica(ruta), original: ruta })),
    // Solo direcciones web: lo demás no se enlaza (la validación lo señala a partir de crudo.enlaces)
    enlaces: crudo.enlaces.filter(esEnlaceWeb).map((url) => ({ url, texto: nombreSitio(url) })),
    // Datos enlazados: el mismo lugar en otras bases (owl:sameAs hacia Wikidata y GeoNames) y sus tipos de schema.org
    equivalentes: lista(fila.mismos).filter(esEnlaceWeb).map((url) => ({ url, texto: nombreSitio(url) })),
    tiposSchema: lista(fila.tiposSchema).map(idDe).sort(),
    coordenadas: crearCoordenadas(fila),
    crudo
  };
}

function crearCoordenadas({ latitud, longitud }) {
  const lat = Number(latitud);
  const lon = Number(longitud);
  return latitud && longitud && Number.isFinite(lat) && Number.isFinite(lon) ? { latitud: lat, longitud: lon } : null;
}

function crearModelos(rutas, nombreAtraccion) {
  return rutas
    .map((ruta) => ({
      // Un modelo único se llama igual que su atracción
      nombre: rutas.length > 1 ? nombreModelo(ruta) : nombreAtraccion,
      ruta: rutaPublica(ruta),
      original: ruta
    }))
    // Primero el modelo que da nombre a la atracción
    .sort((a, b) => nombreAtraccion.includes(b.nombre) - nombreAtraccion.includes(a.nombre) || a.nombre.localeCompare(b.nombre, 'es'));
}

function nombreModelo(ruta) {
  return NOMBRES_MODELO[ruta] ?? nombreLegible(ruta.split('/').pop().replace(/\.\w+$/, ''));
}
