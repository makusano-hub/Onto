// Registro central del sitio.
// Para agregar contenido nuevo casi nunca hay que tocar el código de las páginas:
//  · Un individuo nuevo en la ontología aparece solo si su clase desciende de alguna RAIZ.
//  · Un modelo nuevo: copiar el .glb a public/modelos3d/ y añadir t:tieneModelo3D "modelos3d/archivo.glb".
//  · Una imagen nueva: copiarla a public/imagenes/ y añadir t:tieneImagen "imagenes/archivo.jpg".
//  · Un botón de categoría nuevo: añadir una entrada a CATEGORIAS.

// Dirección pública del sitio (GitHub Pages). Los IRIs de la ontología cuelgan de ella para que se puedan abrir:
// <SITIO>ontologia#FuerteBulnes lleva al documento del vocabulario, que describe ese individuo.
export const SITIO = 'https://makusano-hub.github.io/Onto/';

export const NS = `${SITIO}ontologia#`;

// Vocabulario externo con el que está alineada la ontología (rdfs:subClassOf y rdfs:subPropertyOf)
export const SCHEMA = 'https://schema.org/';

export const PREFIJOS = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX schema: <${SCHEMA}>
PREFIX t: <${NS}>`;

// Un individuo es "atracción" si alguna de sus clases desciende de estas raíces
export const RAICES = ['AtraccionTuristica', 'Establecimientos', 'Actividad'];

// Clases de actividad: no tienen ubicación propia, se ubican a través de t:seRealizaEn
export const RAIZ_ACTIVIDAD = 'Actividad';

// Botones de la landing y del panel. "clases" incluye sus subclases.
// Las seis primeras son las de la portada; el resto mantiene visible el contenido que ya existía.
// "unidad" es cómo se cuenta su contenido en la portada (singular y plural); si falta, "lugar" y "lugares".
export const CATEGORIAS = [
  { id: 'monumentos', nombre: 'Monumentos', clases: ['Estatua'], portada: true },
  { id: 'museos', nombre: 'Museos', clases: ['Museo'], portada: true },
  { id: 'plazas', nombre: 'Plazas', clases: ['Plaza'], portada: true },
  { id: 'actividades', nombre: 'Actividades', clases: ['Actividad'], portada: true, unidad: ['actividad', 'actividades'] },
  { id: 'restaurantes', nombre: 'Restaurantes', clases: ['Restaurante', 'Cafeteria'], portada: true },
  { id: 'hoteles', nombre: 'Hoteles', clases: ['Hotel'], portada: true },
  { id: 'historia', nombre: 'Sitios históricos', clases: ['SitioHistorico'] },
  { id: 'naturaleza', nombre: 'Naturaleza', clases: ['Naturaleza'] },
  { id: 'compras', nombre: 'Compras', clases: ['ZonaTiendas', 'Mercado'] }
];

// Nombre legible de las clases cuyo identificador no basta; otra clase nueva usa su propio nombre.
// Es la única tabla de nombres del sitio (portada, fichas, panel y carta 3D) y debe decir lo mismo que
// el rdfs:label de cada clase en la ontología: la pestaña Validación del panel avisa si dejan de coincidir.
export const NOMBRES_CLASE = {
  Estatua: 'Monumento',
  SitioHistorico: 'Sitio histórico',
  CulturalHistorico: 'Cultural e histórico',
  Rio: 'Río',
  Cafeteria: 'Cafetería',
  PanoramaCiudad: 'Panorama en la ciudad',
  PanoramaCultural: 'Panorama cultural',
  VidaNocturna: 'Vida nocturna',
  ZonaTiendas: 'Zona de tiendas',
  AtraccionTuristica: 'Atracción turística',
  Turistica: 'Actividad turística',
  Cotidiana: 'Actividad cotidiana',
  Navegacion: 'Navegación',
  ObservacionFauna: 'Observación de fauna',
  Establecimientos: 'Establecimiento',
  Alimentacion: 'Alimentación',
  Servicios: 'Servicio',
  Bancario: 'Servicio bancario',
  Entretencion: 'Entretención',
  Nightpub: 'Pub nocturno',
  Lugares: 'Lugar',
  Ubicacion: 'Ubicación',
  Provincias: 'Provincia'
};

// Nombre del botón de cada modelo cuando una atracción tiene varios; otro archivo usa su propio nombre
export const NOMBRES_MODELO = {
  'modelos3d/nao_victoria_model.glb': 'Nao Victoria',
  'modelos3d/hms_beagle_model.glb': 'HMS Beagle',
  'modelos3d/goleta_ancud_model.glb': 'Goleta Ancud'
};

// Formatos que el visor Three.js sabe abrir
export const FORMATOS_MODELO = ['glb', 'gltf'];

// Solo se aceptan identificadores simples, para que un valor de la dirección no altere la consulta
export const ID_VALIDO = /^[\p{L}\p{N}_-]+$/u;

export function idDe(uri) {
  return uri.split('#').pop().split('/').pop();
}

// Convierte "PuertoHambre" o "Isla_Magdalena" en un nombre legible
export function nombreLegible(id) {
  const texto = String(id)
    .replace(/_/g, ' ')
    // Cualquier minúscula seguida de mayúscula, también con tilde ("CaféTapiz")
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    // El espacio de detrás no se consume: así "De La" pone en minúscula los dos conectores
    .replace(/\s(De|Del|La|Las|Los|El)(?=\s)/g, (conector) => conector.toLowerCase())
    .trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function nombreClase(clase) {
  return NOMBRES_CLASE[clase] ?? nombreLegible(clase);
}

export function categoriaPorId(id) {
  return CATEGORIAS.find((categoria) => categoria.id === id) ?? null;
}

// Solo se enlazan direcciones web: un valor de la ontología con otro esquema (javascript:, data:…) se
// ejecutaría al pulsarlo. Vale para t:tieneEnlace y para los IRIs de owl:sameAs.
export const esEnlaceWeb = (url) => /^https?:\/\//i.test(url);

// xsd:boolean admite "true"/"false" y "1"/"0". Fuseki devuelve el texto tal como se escribió y el motor
// del navegador lo normaliza: sin esto, la misma ficha diría cosas distintas según quién responda.
export const esVerdadero = (valor) => valor === 'true' || valor === '1';

// Texto de un enlace externo: los sitios conocidos por su nombre, el resto por su dominio.
// Lo usan la ficha y la carta 3D para los enlaces (t:tieneEnlace) y las equivalencias (owl:sameAs).
const SITIOS = { 'wikipedia.org': 'Wikipedia', 'wikidata.org': 'Wikidata', 'geonames.org': 'GeoNames' };

export function nombreSitio(url) {
  try {
    const dominio = new URL(url).hostname.replace(/^www\./, '');
    const conocido = Object.keys(SITIOS).find((sitio) => dominio === sitio || dominio.endsWith(`.${sitio}`));
    return conocido ? SITIOS[conocido] : dominio;
  } catch {
    return url;
  }
}

// Fuera de Vite (al generar las fichas estáticas con Node) no existe import.meta.env
const BASE = import.meta.env?.BASE_URL ?? './';

// Convierte una ruta de la ontología en una dirección que el navegador puede abrir
export function rutaPublica(ruta) {
  if (/^https?:\/\//i.test(ruta)) return ruta;
  return `${BASE}${ruta.replace(/^\/+/, '')}`;
}
