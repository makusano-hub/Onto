// Parte de la ficha que no necesita el navegador: los campos que se muestran y los datos estructurados.
// La usan ficha.js (en la página) y scripts/publicacion.mjs (al compilar las fichas estáticas).

const formatearNumero = (valor) => Number(valor).toLocaleString('es-CL');
const grados = (valor, positivo, negativo) =>
  `${Math.abs(valor).toLocaleString('es-CL', { maximumFractionDigits: 4 })}° ${valor < 0 ? negativo : positivo}`;

// [campo, etiqueta, texto que se muestra (vacío = no se dibuja)]
export const CAMPOS = [
  ['ciudad', 'Ciudad', (a) => a.ciudad],
  ['comuna', 'Comuna', (a) => a.comuna],
  ['lugar', 'Se realiza en', (a) => a.lugar],
  ['coordenadas', 'Coordenadas', (a) => a.coordenadas && `${grados(a.coordenadas.latitud, 'N', 'S')} · ${grados(a.coordenadas.longitud, 'E', 'O')}`],
  ['calificacion', 'Calificación', (a) => a.calificacion && `${formatearNumero(a.calificacion)} de 5`],
  ['precio', 'Precio', (a) => a.precio && (Number(a.precio) === 0 ? 'Gratis' : `$${Number(a.precio).toLocaleString('es-CL')}`)],
  ['permiso', 'Permiso de la autoridad', (a) => a.requierePermiso && (a.requierePermiso === 'true' ? 'Requerido' : 'No requerido')],
  ['temporada', 'Temporada', (a) => a.tieneTemporada && (a.tieneTemporada === 'true' ? 'Depende de la temporada' : 'Todo el año')]
];

// Datos estructurados de schema.org, enlazados con el individuo de la ontología.
// "base" convierte las rutas de modelos e imágenes en direcciones completas: en el navegador es la página actual;
// al compilar no se conoce el dominio y se dejan relativas a la página.
export function datosEstructurados(
  { uri, nombre, tiposSchema, ciudad, comuna, descripcion, calificacion, coordenadas, modelos, imagenes, enlaces, equivalentes },
  base = globalThis.location?.href
) {
  const mismos = [...equivalentes, ...enlaces].map(({ url }) => url);
  const direccion = (ruta) => (base ? new URL(ruta, base).href : ruta);
  return {
    '@context': 'https://schema.org',
    // Los tipos salen de la ontología: las clases de schema.org de las que desciende la clase del individuo
    '@type': tiposSchema.length ? tiposSchema : 'TouristAttraction',
    '@id': uri,
    name: nombre,
    ...(descripcion && { description: descripcion }),
    ...((ciudad || comuna) && {
      address: {
        '@type': 'PostalAddress',
        addressLocality: ciudad ?? comuna,
        addressRegion: 'Región de Magallanes y de la Antártica Chilena',
        addressCountry: 'CL'
      }
    }),
    ...(calificacion && {
      aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(calificacion), bestRating: 5 }
    }),
    ...(coordenadas && {
      geo: { '@type': 'GeoCoordinates', latitude: coordenadas.latitud, longitude: coordenadas.longitud }
    }),
    ...(imagenes.length && { image: imagenes.map(({ ruta }) => direccion(ruta)) }),
    ...(mismos.length && { sameAs: mismos }),
    ...(modelos.length && {
      subjectOf: modelos.map((modelo) => ({
        '@type': '3DModel',
        name: `Modelo 3D de ${modelo.nombre}`,
        encoding: { '@type': 'MediaObject', contentUrl: direccion(modelo.ruta) }
      }))
    })
  };
}
