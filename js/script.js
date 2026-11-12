// Ficha pública de una atracción: atraccion.html?id=...
import { obtenerAtraccion } from './ontologia.js';
import { renderizarFicha, datosEstructurados } from './ficha.js';

const contenedor = document.getElementById('ficha');
const estado = document.getElementById('estado-ficha');

iniciar();

async function iniciar() {
  const id = new URLSearchParams(window.location.search).get('id');
  let atraccion;

  try {
    atraccion = await obtenerAtraccion(id);
  } catch (error) {
    console.error('Error consultando Fuseki:', error);
    estado.textContent = 'No se pudo conectar con Fuseki. Comprueba que esté en ejecución y recarga la página.';
    return;
  }

  if (!atraccion) {
    estado.textContent = 'Esta atracción no existe. Vuelve a la lista para elegir otra.';
    return;
  }

  document.title = `${atraccion.nombre} | Atracciones turísticas de Magallanes`;
  renderizarFicha(contenedor, atraccion);

  const datos = document.createElement('script');
  datos.type = 'application/ld+json';
  datos.textContent = JSON.stringify(datosEstructurados(atraccion));
  document.head.appendChild(datos);
}
