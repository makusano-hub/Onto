// Ficha pública de una atracción.
//  · atraccion.html?id=...  pide los datos con una consulta SPARQL (a Fuseki o al motor del navegador).
//  · ficha/<id>.html        (generada al compilar) los trae incrustados junto con su JSON-LD: no consulta nada.
import { obtenerAtraccion } from './ontologia.js';
import { renderizarFicha, datosEstructurados } from './ficha.js';

const contenedor = document.getElementById('ficha');
const estado = document.getElementById('estado-ficha');
const incrustados = document.getElementById('datos-atraccion');

if (incrustados) renderizarFicha(contenedor, JSON.parse(incrustados.textContent));
else iniciar();

async function iniciar() {
  const id = new URLSearchParams(window.location.search).get('id');
  let atraccion;

  try {
    atraccion = await obtenerAtraccion(id);
  } catch (error) {
    console.error('Error consultando los datos:', error);
    estado.textContent = 'No se pudieron consultar los datos: Fuseki no responde y el motor SPARQL del navegador no se pudo cargar. Recarga la página.';
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
