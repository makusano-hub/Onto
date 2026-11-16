// Registro central del sitio.
// Para agregar contenido nuevo casi nunca hay que tocar el código de las páginas:
//  · Un individuo nuevo en la ontología aparece solo si su clase desciende de alguna RAIZ.
//  · Un modelo nuevo: copiar el .glb a public/modelos3d/ y añadir t:tieneModelo3D "modelos3d/archivo.glb".
//  · Una imagen nueva: copiarla a public/imagenes/ y añadir t:tieneImagen "imagenes/archivo.jpg".
//  · Un botón de categoría nuevo: añadir una entrada a CATEGORIAS.

export const NS = 'http://www.semanticweb.org/usuario/ontologies/2026/9/Ontologia2#';

// Vocabulario externo con el que está alineada la ontología (rdfs:subClassOf y rdfs:subPropertyOf)
export const SCHEMA = 'https://schema.org/';

export const PREFIJOS = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX schema: <${SCHEMA}>
PREFIX t: <${NS}>`;

// Un individuo es "atracción" si alguna de sus clases desciende de estas raíces
export const RAICES = ['CulturalHistorico', 'ZonaTuristica', 'Establecimientos', 'Actividad'];

// Clases de actividad: no tienen ubicación propia, se ubican a través de t:seRealizaEn
export const RAIZ_ACTIVIDAD = 'Actividad';

// Botones de la landing y del panel. "clases" incluye sus subclases.
// Las seis primeras son las de la portada; el resto mantiene visible el contenido que ya existía.
export const CATEGORIAS = [
  { id: 'monumentos', nombre: 'Monumentos', clases: ['Estatua'], portada: true },
  { id: 'museos', nombre: 'Museos', clases: ['Museo'], portada: true },
  { id: 'plazas', nombre: 'Plazas', clases: ['Plaza'], portada: true },
  { id: 'actividades', nombre: 'Actividades', clases: ['Actividad'], portada: true },
  { id: 'restaurantes', nombre: 'Restaurantes', clases: ['Restaurante', 'Cafeteria'], portada: true },
  { id: 'hoteles', nombre: 'Hoteles', clases: ['Hotel'], portada: true },
  { id: 'historia', nombre: 'Sitios históricos', clases: ['SitioHistorico'] },
  { id: 'naturaleza', nombre: 'Naturaleza', clases: ['Naturaleza'] },
  { id: 'compras', nombre: 'Compras', clases: ['ZonaTiendas', 'Mercado'] }
];

// Nombre legible de algunas clases; otra clase nueva usa su propio nombre
export const NOMBRES_CLASE = {
  Estatua: 'Monumento',
  SitioHistorico: 'Sitio histórico',
  Montaña: 'Montaña',
  Rio: 'Río',
  Cafeteria: 'Cafetería',
  PanoramaCiudad: 'Panorama en la ciudad',
  PescaDeportiva: 'Pesca deportiva',
  ZonaTiendas: 'Zona de tiendas'
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
  const texto = id
    .replace(/_/g, ' ')
    .replace(/([a-zñ])([A-Z])/g, '$1 $2')
    .replace(/\s(De|Del|La|Las|Los|El)\s/g, (conector) => conector.toLowerCase());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function nombreClase(clase) {
  return NOMBRES_CLASE[clase] ?? nombreLegible(clase);
}

export function categoriaPorId(id) {
  return CATEGORIAS.find((categoria) => categoria.id === id) ?? null;
}

// Convierte una ruta de la ontología en una dirección que el navegador puede abrir
export function rutaPublica(ruta) {
  if (/^https?:\/\//i.test(ruta)) return ruta;
  return `${import.meta.env.BASE_URL}${ruta.replace(/^\/+/, '')}`;
}
