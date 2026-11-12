// Convierte las respuestas de Fuseki en objetos que usan las páginas
import { consultarSPARQL } from './fuseki.js';
import { construir, SEP } from './consultas.js';
import {
  CATEGORIAS, NS, ID_VALIDO, NOMBRES_MODELO,
  idDe, nombreLegible, nombreClase, categoriaPorId, rutaPublica
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
    categoria: CATEGORIAS.map(({ id, nombre, portada }) => ({
      id, nombre, portada: Boolean(portada), total: totalPorCategoria[id] ?? 0
    }))
  };
}

export async function buscarAtracciones({ comuna, categoria }) {
  const filas = await consultarSPARQL(construir.busqueda({
    comuna: comuna ? validarId(comuna) : '',
    categoria: categoria ? categoriaPorId(categoria) : null
  }));
  return ordenar(filas.map(crearAtraccion));
}

export async function obtenerInventario() {
  const filas = await consultarSPARQL(construir.inventario());
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

const lista = (valor) => (valor ? valor.split(SEP).filter(Boolean) : []);
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

  return {
    id,
    uri: fila.atraccion,
    enEspacioPrincipal: fila.atraccion.startsWith(NS),
    nombre,
    clases,
    tipo: clases.map(nombreClase).join(' / '),
    ciudad: nombres(crudo.ciudades).join(', ') || null,
    comuna: nombres(crudo.comunas).join(', ') || null,
    comunaIds: crudo.comunas.map(idDe),
    lugar: nombres(crudo.lugares).join(', ') || null,
    lugarIds: crudo.lugares.map(idDe),
    descripcion: crudo.descripciones[0] ?? '',
    calificacion: crudo.calificaciones[0] ?? null,
    precio: crudo.precios[0] ?? null,
    requierePermiso: fila.requierePermiso ?? null,
    tieneTemporada: fila.tieneTemporada ?? null,
    modelos: crearModelos(crudo.modelos, nombre),
    imagenes: crudo.imagenes.map((ruta) => ({ ruta: rutaPublica(ruta), original: ruta })),
    enlaces: crudo.enlaces.map((url) => ({ url, texto: textoEnlace(url) })),
    crudo
  };
}

function textoEnlace(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
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
