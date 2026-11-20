// Regenera js/grafo-datos.js (copia de respaldo de la carta 3D) a partir de ontologia/turismo.rdf.
// Uso: node scripts/generar-copia.mjs [entrada.rdf] [salida.js]
import { readFileSync, writeFileSync } from 'node:fs';

const [entrada = 'ontologia/turismo.rdf', salida = 'js/grafo-datos.js'] = process.argv.slice(2);
const xml = readFileSync(entrada, 'utf8');

const local = (iri) => decodeURIComponent(iri.slice(iri.indexOf('#') + 1));
const texto = (s) => s.replace(/\r\n/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Espacio de nombres propio: las superclases de schema.org no forman parte de la jerarquía de la carta
const NS = `${xml.match(/<owl:Ontology rdf:about="([^"]+)"/)[1]}#`;

// Valor de una relación: los términos propios y los de OWL se acortan; un IRI externo (owl:sameAs hacia
// Wikidata o GeoNames) se conserva entero aunque lleve "#", igual que hace nodo() en js/grafo.js
const OWL = 'http://www.w3.org/2002/07/owl#';
const nodo = (iri) => (iri.startsWith(NS) || iri.startsWith(OWL) ? local(iri) : texto(iri));

// Jerarquía de clases: clase -> superclase
const sub = {};
for (const [, clase, cuerpo] of xml.matchAll(/<owl:Class rdf:about="([^"]+)">([\s\S]*?)<\/owl:Class>/g)) {
  const padre = [...cuerpo.matchAll(/<rdfs:subClassOf rdf:resource="([^"]+)"\/>/g)].map(([, iri]) => iri).find((iri) => iri.startsWith(NS));
  if (clase.startsWith(NS) && padre) sub[local(clase)] = local(padre);
}

// Tripletas de los individuos: [sujeto, propiedad, valor, 1 si el valor es otro nodo]
const tri = [];
for (const [, sujeto, cuerpo] of xml.matchAll(/<owl:NamedIndividual rdf:about="([^"]+)">([\s\S]*?)<\/owl:NamedIndividual>/g)) {
  const s = local(sujeto);
  for (const [, etiqueta, recurso, , valor] of cuerpo.matchAll(/<([\w:]+)(?:\s+rdf:resource="([^"]+)"\/>|(\s+[^>]*)?>([\s\S]*?)<\/\1>)/g)) {
    const p = etiqueta.split(':')[1];
    if (recurso !== undefined) tri.push([s, p, nodo(recurso), 1]);
    else tri.push([s, p, texto(valor), 0]);
  }
}

const ordenadas = Object.fromEntries(Object.keys(sub).sort().map((k) => [k, sub[k]]));
writeFileSync(salida, `// Copia de respaldo de la ontología para la carta 3D (generada, no editar a mano)

// COPIA: copia de turismo.rdf que se usa si Fuseki no responde
export const COPIA = ${JSON.stringify({ sub: ordenadas, tri })};
`);
console.log(`${salida}: ${Object.keys(sub).length} clases, ${tri.length} tripletas`);
