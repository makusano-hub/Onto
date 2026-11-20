// Validación con SHACL: envía las reglas de ontologia/turismo.shacl.ttl a Fuseki y lee su informe.
// Necesita el endpoint /turismo/shacl, que define fuseki/config.ttl.
// Sin Fuseki (el sitio publicado) lee el informe que Fuseki dejó al compilar: en el navegador no hay motor SHACL.
import formas from '../ontologia/turismo.shacl.ttl?raw';
import { ENDPOINT_SHACL, origenDeDatos } from './fuseki.js';
import { NS, rutaPublica } from './catalogo.js';

const SH = 'http://www.w3.org/ns/shacl#';
const NIVELES = { Violation: 'error', Warning: 'aviso', Info: 'aviso' };

// Lo escribe scripts/publicacion.mjs con la misma petición que se hace aquí
const INFORME_PUBLICADO = 'datos/informe-shacl.nt';

async function informePublicado() {
  const respuesta = await fetch(new URL(rutaPublica(INFORME_PUBLICADO), document.baseURI), { headers: { Accept: 'application/n-triples' } });
  if (!respuesta.ok) {
    const error = new Error(`no está ${INFORME_PUBLICADO} (${respuesta.status})`);
    error.sinInforme = true;
    throw error;
  }
  return leerInforme(await respuesta.text());
}

// Resultados del informe: { nivel, mensaje, individuo, propiedad, valor }
export async function validarSHACL() {
  if ((await origenDeDatos()) === 'navegador') return informePublicado();

  const respuesta = await fetch(`${ENDPOINT_SHACL}?graph=default`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/turtle', Accept: 'application/n-triples' },
    body: formas
  });

  if (!respuesta.ok) {
    const error = new Error(`Error en Fuseki: ${respuesta.status}`);
    error.estado = respuesta.status;
    throw error;
  }

  return leerInforme(await respuesta.text());
}

const corto = (iri) => (iri.startsWith(NS) ? iri.slice(NS.length) : iri);

// Un término N-Triples: <iri>, _:nodo o "literal" (con idioma o tipo de dato)
function termino(texto) {
  if (texto.startsWith('<')) return { iri: texto.slice(1, texto.indexOf('>')) };
  if (texto.startsWith('_:')) return { nodo: texto };
  const [, crudo = ''] = texto.match(/^"((?:[^"\\]|\\.)*)"/) ?? [];
  const ESCAPES = { n: '\n', r: '\r', t: '\t' };
  return {
    literal: crudo.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, escape) =>
      (escape.length > 1 ? String.fromCodePoint(parseInt(escape.slice(1), 16)) : ESCAPES[escape] ?? escape))
  };
}

// El informe llega en N-Triples: una tripleta por línea, fácil de leer sin librerías
export function leerInforme(ntriples) {
  const nodos = new Map();

  ntriples.split(/\r?\n/).forEach((linea) => {
    const partes = linea.match(/^(<[^>]*>|_:\S+)\s+<([^>]*)>\s+(.+?)\s*\.\s*$/);
    if (!partes || !partes[2].startsWith(SH)) return;
    const [, sujeto, predicado, objeto] = partes;
    if (!nodos.has(sujeto)) nodos.set(sujeto, {});
    nodos.get(sujeto)[predicado.slice(SH.length)] = termino(objeto);
  });

  return [...nodos.values()]
    .filter((nodo) => nodo.resultSeverity && nodo.focusNode)
    .map((nodo) => ({
      nivel: NIVELES[nodo.resultSeverity.iri.slice(SH.length)] ?? 'aviso',
      mensaje: nodo.resultMessage?.literal ?? 'No cumple una regla SHACL.',
      individuo: corto(nodo.focusNode.iri ?? nodo.focusNode.nodo),
      propiedad: nodo.resultPath?.iri ? corto(nodo.resultPath.iri) : null,
      valor: nodo.value ? nodo.value.literal ?? corto(nodo.value.iri ?? '') : null
    }))
    .sort((a, b) => (a.nivel === b.nivel ? a.individuo.localeCompare(b.individuo, 'es') : a.nivel === 'error' ? -1 : 1));
}
