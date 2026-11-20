// Motor SPARQL del navegador: responde las consultas del sitio donde no hay Fuseki (por ejemplo, en GitHub Pages).
// Es Oxigraph compilado a WebAssembly. Lee los mismos archivos que el sitio publica en datos/,
// así que el sitio consulta sus propios datos abiertos. Solo lee: no admite INSERT ni DELETE.
// Se carga bajo demanda desde js/fuseki.js: con Fuseki en marcha no se descarga.
import init, { Store } from 'oxigraph/web.js';
import { rutaPublica } from './catalogo.js';

// Grafos disponibles y el archivo publicado del que sale cada uno (scripts/publicacion.mjs)
const GRAFOS = {
  // El archivo fuente de la ontología, tal como está en el repositorio
  declarado: { archivo: 'datos/turismo.rdf', formato: 'application/rdf+xml', nombre: 'turismo.rdf' },
  // Lo que deduce el razonador de Fuseki, guardado al compilar: en el navegador no hay razonador
  inferido: { archivo: 'datos/turismo-inferido.ttl', formato: 'text/turtle', nombre: 'el grafo con inferencia' }
};

let motor; // promesa: el WebAssembly se compila una sola vez
const almacenes = new Map(); // grafo → promesa de su almacén, ya cargado

// Si la descarga o la compilación fallan, la promesa se descarta: guardada, cada consulta posterior
// recibiría el mismo error hasta recargar la página aunque el fallo hubiera sido pasajero.
function iniciarMotor() {
  motor ??= init().catch((error) => {
    motor = undefined;
    throw error;
  });
  return motor;
}

async function cargar(grafo) {
  const { archivo, formato, nombre } = GRAFOS[grafo];
  const direccion = new URL(rutaPublica(archivo), document.baseURI);

  // Accept: sin él, un servidor de desarrollo puede responder con la portada en vez de un 404
  const [respuesta] = await Promise.all([fetch(direccion, { headers: { Accept: formato } }), iniciarMotor()]);
  if (!respuesta.ok) {
    const error = new Error(`No se pudo leer ${nombre} (${archivo}: ${respuesta.status})`);
    error.estado = respuesta.status;
    error.detalle = grafo === 'inferido'
      ? 'El grafo con inferencia lo escribe Fuseki al compilar el sitio. Inicia Fuseki con fuseki/config.ttl o desmarca "Con inferencia".'
      : '';
    throw error;
  }

  const almacen = new Store();
  almacen.load(await respuesta.text(), { format: formato, base_iri: direccion.href });
  return almacen;
}

function almacenDe(grafo) {
  if (!almacenes.has(grafo)) {
    const carga = cargar(grafo);
    almacenes.set(grafo, carga);
    // Una carga fallida no se guarda: la siguiente consulta lo intenta de nuevo
    carga.catch(() => almacenes.delete(grafo));
  }
  return almacenes.get(grafo);
}

// Responde con la misma forma que un endpoint SPARQL (application/sparql-results+json):
// { head: { vars }, results: { bindings } } para SELECT y { boolean } para ASK
export async function consultar(consulta, grafo = 'declarado') {
  const almacen = await almacenDe(grafo);

  try {
    return JSON.parse(almacen.query(consulta, { results_format: 'json' }));
  } catch (fallo) {
    // Errores de sintaxis y consultas que no devuelven una tabla (CONSTRUCT, DESCRIBE)
    const error = new Error('Error en la consulta SPARQL');
    error.detalle = String(fallo?.message ?? fallo);
    error.estado = 400;
    throw error;
  }
}
