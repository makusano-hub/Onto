// Ficha reutilizable de una atracción: la usan atraccion.html y el panel.
// Cada parte lleva data-campo para que la validación compruebe lo que realmente se dibuja.
import { crearVisor } from './visor3d.js';
import { CAMPOS } from './ficha-datos.js';

// Los datos estructurados viven en ficha-datos.js, que también se usa al compilar
export { datosEstructurados } from './ficha-datos.js';

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
  const { nombre, tipo, comuna, descripcion, modelos, imagenes, enlaces, equivalentes } = atraccion;

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

  // owl:sameAs: el mismo lugar en otras bases de datos (Wikidata)
  const listaEquivalentes = equivalentes.length
    ? el('ul', { class: 'ficha-enlaces', 'data-campo': 'equivalentes', 'aria-label': 'Este lugar en otras bases de datos' },
      ...equivalentes.map(({ url, texto }) => el('li', {},
        el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', texto: `${texto} ↗` }))))
    : null;

  const ficha = el('article', { class: 'ficha-atraccion', 'data-atraccion': atraccion.id },
    titulo, categoria, figura, galeria, datos, listaEnlaces, listaEquivalentes);
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
