// Ficha reutilizable de una atracción: la usan atraccion.html y el panel.
// Cada parte lleva data-campo para que la validación compruebe lo que realmente se dibuja.
import { crearVisor } from './visor3d.js';

const CAMPOS = [
  ['ciudad', 'Ciudad', (a) => a.ciudad],
  ['comuna', 'Comuna', (a) => a.comuna],
  ['lugar', 'Se realiza en', (a) => a.lugar],
  ['calificacion', 'Calificación', (a) => a.calificacion && `${formatearNumero(a.calificacion)} de 5`],
  ['precio', 'Precio', (a) => a.precio && (Number(a.precio) === 0 ? 'Gratis' : `$${Number(a.precio).toLocaleString('es-CL')}`)],
  ['permiso', 'Permiso de la autoridad', (a) => a.requierePermiso && (a.requierePermiso === 'true' ? 'Requerido' : 'No requerido')],
  ['temporada', 'Temporada', (a) => a.tieneTemporada && (a.tieneTemporada === 'true' ? 'Depende de la temporada' : 'Todo el año')]
];

const formatearNumero = (valor) => Number(valor).toLocaleString('es-CL');

function el(etiqueta, atributos = {}, ...hijos) {
  const elemento = document.createElement(etiqueta);
  Object.entries(atributos).forEach(([clave, valor]) => {
    if (valor == null || valor === false) return;
    if (clave === 'texto') elemento.textContent = valor;
    else elemento.setAttribute(clave, valor === true ? '' : valor);
  });
  elemento.append(...hijos.filter(Boolean));
  return elemento;
}

// Dibuja la ficha en el contenedor. Con visor: false no crea el visor 3D (útil para pruebas).
export function renderizarFicha(contenedor, atraccion, { visor = true, nivelTitulo = 'h1' } = {}) {
  const { nombre, tipo, comuna, descripcion, modelos, imagenes, enlaces } = atraccion;

  const titulo = el(nivelTitulo, { class: 'ficha-nombre', 'data-campo': 'nombre', texto: nombre });
  const categoria = el('p', {
    class: 'categoria-atraccion', 'data-campo': 'categoria',
    texto: comuna ? `${tipo} · ${comuna}` : tipo
  });

  const selector = el('div', { class: 'grupo-botones selector-modelos', role: 'group', 'aria-label': 'Modelo 3D que se muestra' });
  const estado = el('p', { class: 'estado-visor', role: 'status' });
  const lienzo = el('div', { class: 'visor3d', 'data-campo': 'modelo' }, estado);
  const figura = el('figure', { class: 'ficha-figura' },
    selector, lienzo,
    descripcion && el('figcaption', { 'data-campo': 'descripcion', texto: descripcion }));

  const galeria = imagenes.length
    ? el('ul', { class: 'ficha-galeria', 'data-campo': 'imagenes', 'aria-label': 'Imágenes' },
      ...imagenes.map(({ ruta }, indice) => el('li', {},
        el('img', { src: ruta, alt: `${nombre}, imagen ${indice + 1}`, loading: 'lazy' }))))
    : null;

  const datos = el('dl', { class: 'datos-atraccion' },
    ...CAMPOS.map(([campo, etiqueta, valor]) => {
      const texto = valor(atraccion);
      return texto && el('div', { 'data-campo': campo }, el('dt', { texto: etiqueta }), el('dd', { texto }));
    }));

  const listaEnlaces = enlaces.length
    ? el('ul', { class: 'ficha-enlaces', 'data-campo': 'enlaces', 'aria-label': 'Enlaces' },
      ...enlaces.map(({ url, texto }) => el('li', {},
        el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', texto: `${texto} ↗` }))))
    : null;

  const ficha = el('article', { class: 'ficha-atraccion', 'data-atraccion': atraccion.id },
    titulo, categoria, figura, galeria, datos, listaEnlaces);
  contenedor.replaceChildren(ficha);

  let visor3d = null;
  if (visor && modelos.length) {
    visor3d = crearVisor(lienzo, { estado, selector });
    visor3d.mostrar(modelos);
  } else {
    estado.textContent = modelos.length ? 'Vista previa sin visor 3D.' : 'Esta atracción aún no tiene modelo 3D.';
    lienzo.classList.add('sin-modelo');
  }

  return {
    elemento: ficha,
    destruir() {
      visor3d?.destruir();
    }
  };
}

// Datos estructurados de schema.org, enlazados con el individuo de la ontología
export function datosEstructurados({ uri, nombre, ciudad, comuna, descripcion, calificacion, modelos, imagenes, enlaces }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
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
    ...(imagenes.length && { image: imagenes.map(({ ruta }) => new URL(ruta, window.location.href).href) }),
    ...(enlaces.length && { sameAs: enlaces.map(({ url }) => url) }),
    ...(modelos.length && {
      subjectOf: modelos.map((modelo) => ({
        '@type': '3DModel',
        name: `Modelo 3D de ${modelo.nombre}`,
        encoding: { '@type': 'MediaObject', contentUrl: new URL(modelo.ruta, window.location.href).href }
      }))
    })
  };
}
