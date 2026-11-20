// Todas las consultas SPARQL del sitio. Las responde Fuseki o, donde no lo hay, el motor del navegador (js/fuseki.js).
// Están aquí, con nombre y descripción, para poder revisarlas y probarlas desde el panel (panel.html#consultas).
import { PREFIJOS, RAICES, CATEGORIAS, NS, SCHEMA } from './catalogo.js';

// Separador de los valores agrupados; no aparece en textos normales
export const SEP = '␟';

const raices = RAICES.map((clase) => `t:${clase}`).join(' ');

// Un lugar es atracción si su clase desciende de alguna raíz.
// Una actividad se ubica a través del lugar donde se realiza.
// La comuna puede estar indicada directamente o a través de la ciudad.
const PATRON_ATRACCION = `
  VALUES ?raiz { ${raices} }
  ?atraccion a ?clase .
  ?clase rdfs:subClassOf* ?raiz .
  OPTIONAL { ?atraccion t:seRealizaEn|^t:permiteActividad ?lugar }
  BIND(COALESCE(?lugar, ?atraccion) AS ?sitio)
  OPTIONAL { ?sitio t:ubicadoEnCiudad ?ciudad }
  OPTIONAL {
    { ?sitio t:ubicadoEnComuna ?comuna }
    UNION
    { ?sitio t:ubicadoEnCiudad/t:perteneceAComuna ?comuna }
  }`;

// COALESCE: sin él, una sola fila sin valor anula el grupo entero
// (por ejemplo, una actividad con tres lugares y uno de ellos sin comuna se quedaba sin comuna)
const agrupar = (variable, alias = `${variable}s`) =>
  `(GROUP_CONCAT(DISTINCT COALESCE(STR(?${variable}), ""); SEPARATOR="${SEP}") AS ?${alias})`;

// "filtros" recorta qué atracciones entran. "comuna" se comprueba con HAVING, después de agrupar:
// como FILTER dentro del WHERE quitaba las filas de las otras comunas, y una atracción con lugares
// en varias comunas perdía esos lugares, ciudades y comunas al filtrar.
function inventario(filtros = '', comuna = '') {
  return `${PREFIJOS}
SELECT ?atraccion
       ${agrupar('clase')} ${agrupar('nombre')} ${agrupar('descripcion', 'descripciones')}
       ${agrupar('calificacion', 'calificaciones')} ${agrupar('precio')}
       (SAMPLE(STR(?requierePermiso)) AS ?requierePermiso) (SAMPLE(STR(?tieneTemporada)) AS ?tieneTemporada)
       (SAMPLE(STR(?latitud)) AS ?latitud) (SAMPLE(STR(?longitud)) AS ?longitud)
       ${agrupar('modelo')} ${agrupar('imagen', 'imagenes')} ${agrupar('enlace')}
       ${agrupar('mismo')} ${agrupar('tipoSchema', 'tiposSchema')}
       ${agrupar('lugar', 'lugares')} ${agrupar('ciudad', 'ciudades')} ${agrupar('comuna')}
WHERE {
  ${PATRON_ATRACCION.trim()}
  OPTIONAL { ?atraccion t:Nombre ?nombre }
  OPTIONAL { ?atraccion t:Descripcion ?descripcion }
  OPTIONAL { ?atraccion t:Calificacion ?calificacion }
  OPTIONAL { ?atraccion t:Precio ?precio }
  OPTIONAL { ?atraccion t:requierePermisoAutoridad ?requierePermiso }
  OPTIONAL { ?atraccion t:tieneTemporada ?tieneTemporada }
  OPTIONAL { ?atraccion t:tieneModelo3D ?modelo }
  OPTIONAL { ?atraccion t:tieneImagen ?imagen }
  OPTIONAL { ?atraccion t:tieneEnlace ?enlace }
  OPTIONAL { ?atraccion t:Latitud ?latitud ; t:Longitud ?longitud }
  OPTIONAL { ?atraccion owl:sameAs ?mismo }
  OPTIONAL { ?clase rdfs:subClassOf+ ?tipoSchema FILTER(STRSTARTS(STR(?tipoSchema), "${SCHEMA}")) }${filtros ? `\n  ${filtros.trim()}` : ''}
}
GROUP BY ?atraccion${comuna ? `\nHAVING (SUM(IF(BOUND(?comuna) && ?comuna = <${NS}${comuna}>, 1, 0)) > 0)` : ''}`;
}

// Subconsulta y no FILTER EXISTS: elige las mismas atracciones, pero se evalúa una sola vez en lugar de
// una por fila. En el motor del navegador (Oxigraph) el FILTER EXISTS tardaba unos 200 ms; así, unos 10.
function filtroCategoria(categoria) {
  if (!categoria) return '';
  const clases = categoria.clases.map((clase) => `t:${clase}`).join(' ');
  return `{ SELECT DISTINCT ?atraccion WHERE { VALUES ?claseCategoria { ${clases} } ?atraccion a/rdfs:subClassOf* ?claseCategoria } }`;
}

// Constructores usados por ontologia.js. Los identificadores llegan ya validados.
export const construir = {
  inventario: () => inventario(),

  busqueda: ({ comuna, categoria }) => inventario(filtroCategoria(categoria), comuna),

  // Algunos individuos usan otro espacio de nombres: se busca por la última parte del IRI
  ficha: (id) => inventario(`FILTER(REPLACE(STR(?atraccion), "^.*[#/]", "") = "${id}")`),

  comunas: () => `${PREFIJOS}
SELECT ?comuna (COUNT(DISTINCT ?atraccion) AS ?total) WHERE {
  ${PATRON_ATRACCION.trim()}
  FILTER(BOUND(?comuna))
}
GROUP BY ?comuna`,

  categorias: () => `${PREFIJOS}
SELECT ?categoria (COUNT(DISTINCT ?atraccion) AS ?total) WHERE {
  VALUES (?categoria ?claseCategoria) {
    ${CATEGORIAS.flatMap(({ id, clases }) => clases.map((clase) => `("${id}" t:${clase})`)).join('\n    ')}
  }
  ?atraccion a/rdfs:subClassOf* ?claseCategoria .
}
GROUP BY ?categoria`,

  // Solo las clases propias: las de schema.org se usan como superclase, no como categoría del sitio
  jerarquia: () => `${PREFIJOS}
SELECT ?clase ?padre ?etiqueta WHERE {
  ?clase a owl:Class .
  FILTER(STRSTARTS(STR(?clase), STR(t:)))
  OPTIONAL { ?clase rdfs:subClassOf ?padre FILTER(STRSTARTS(STR(?padre), STR(t:))) }
  OPTIONAL { ?clase rdfs:label ?etiqueta }
}`,

  // Tipos de todo lo que tiene tipo: sirve para comprobar que ciudades, comunas y lugares existen
  tipos: () => `${PREFIJOS}
SELECT ?individuo ${agrupar('tipo')} WHERE {
  ?individuo a ?tipo .
  FILTER(?tipo NOT IN (owl:NamedIndividual, owl:Class, owl:ObjectProperty, owl:DatatypeProperty, owl:AnnotationProperty, owl:Ontology))
}
GROUP BY ?individuo`,

  ciudades: () => `${PREFIJOS}
SELECT ?ciudad ${agrupar('comuna')} WHERE {
  ?ciudad a t:Ciudad .
  OPTIONAL { ?ciudad t:perteneceAComuna ?comuna }
}
GROUP BY ?ciudad`,

  // Todo lo que la ontología dice de sus propios términos: con ello se escribe el documento del vocabulario
  vocabulario: () => `${PREFIJOS}
SELECT ?termino ?propiedad ?valor WHERE {
  ?termino ?propiedad ?valor .
  FILTER(STRSTARTS(STR(?termino), STR(t:)))
}`,

  // Individuos con datos de atracción cuya clase no cuelga de ninguna raíz: no se verían en el sitio
  huerfanos: () => `${PREFIJOS}
SELECT DISTINCT ?individuo ?tipo WHERE {
  ?individuo t:Nombre|t:Descripcion|t:tieneModelo3D|t:ubicadoEnCiudad|t:ubicadoEnComuna|t:seRealizaEn ?valor .
  OPTIONAL { ?individuo a ?tipo FILTER(?tipo != owl:NamedIndividual) }
  FILTER NOT EXISTS {
    VALUES ?raiz { ${raices} }
    ?individuo a/rdfs:subClassOf* ?raiz
  }
}`
};

// Catálogo que muestra el panel: qué consulta es, quién la usa y su texto de ejemplo
export const CONSULTAS = [
  {
    id: 'busqueda',
    titulo: 'Atracciones filtradas',
    usadaEn: 'Portada (index.html) y panel',
    descripcion: 'Lista de atracciones con todos sus datos. La portada la envía cada vez que se pulsa un botón de comuna o categoría.',
    texto: () => construir.busqueda({ comuna: 'PuntaArenas', categoria: CATEGORIAS[0] })
  },
  {
    id: 'ficha',
    titulo: 'Ficha de una atracción',
    usadaEn: 'atraccion.html y panel',
    descripcion: 'Mismos datos que la lista, para un solo individuo. Busca por la última parte del IRI. Incluye sus coordenadas, su owl:sameAs y los tipos de schema.org de los que desciende su clase.',
    texto: () => construir.ficha('FuerteBulnes')
  },
  {
    id: 'inventario',
    titulo: 'Inventario completo',
    usadaEn: 'Panel y validación',
    descripcion: 'Todas las atracciones sin filtrar. Los valores repetidos se agrupan con ␟ para detectar duplicados.',
    texto: construir.inventario
  },
  {
    id: 'comunas',
    titulo: 'Comunas con atracciones',
    usadaEn: 'Botones de comuna',
    descripcion: 'Solo se muestran las comunas que tienen al menos una atracción.',
    texto: construir.comunas
  },
  {
    id: 'categorias',
    titulo: 'Atracciones por categoría',
    usadaEn: 'Botones de categoría',
    descripcion: 'Cuenta los individuos de cada categoría definida en js/catalogo.js, incluidas sus subclases.',
    texto: construir.categorias
  },
  {
    id: 'jerarquia',
    titulo: 'Jerarquía de clases',
    usadaEn: 'Validación',
    descripcion: 'Clases declaradas, su clase padre directa y su etiqueta (rdfs:label), que se compara con el nombre que muestra el sitio.',
    texto: construir.jerarquia
  },
  {
    id: 'ciudades',
    titulo: 'Ciudades y su comuna',
    usadaEn: 'Validación',
    descripcion: 'Una ciudad sin t:perteneceAComuna deja sin comuna a todas sus atracciones.',
    texto: construir.ciudades
  },
  {
    id: 'huerfanos',
    titulo: 'Individuos fuera del sitio',
    usadaEn: 'Validación',
    descripcion: 'Tienen datos de atracción pero su clase no desciende de ninguna raíz, así que el sitio no los muestra.',
    texto: construir.huerfanos
  },
  {
    id: 'vocabulario',
    titulo: 'Vocabulario completo',
    usadaEn: 'Documento del vocabulario (ontologia/)',
    descripcion: 'Todas las tripletas de las clases, propiedades e individuos propios. Con ellas se escribe la página a la que llevan los IRIs de la ontología.',
    texto: construir.vocabulario
  },
  // Estas dos solo dan resultado completo con el razonador (endpoint /turismo-inferido de fuseki/config.ttl)
  {
    id: 'lugares-schema',
    titulo: 'Lugares según schema.org',
    usadaEn: 'Solo en el panel · con inferencia',
    inferencia: true,
    descripcion: 'Ningún individuo declara schema:Place ni schema:name: el razonador los deduce de rdfs:subClassOf y rdfs:subPropertyOf. Desmarca "Con inferencia" y la misma consulta no devuelve nada.',
    texto: () => `${PREFIJOS}
SELECT ?lugar ?nombre WHERE {
  ?lugar a schema:Place ;
         schema:name ?nombre .
}
ORDER BY ?nombre`
  },
  {
    id: 'actividades-por-lugar',
    titulo: 'Actividades que permite cada lugar',
    usadaEn: 'Solo en el panel · con inferencia',
    inferencia: true,
    descripcion: 'Casi todos los datos dicen t:seRealizaEn (actividad → lugar). El razonador deduce t:permiteActividad (lugar → actividad) porque la ontología las declara inversas con owl:inverseOf.',
    texto: () => `${PREFIJOS}
SELECT ?lugar ?actividad WHERE {
  ?lugar t:permiteActividad ?actividad .
}
ORDER BY ?lugar ?actividad`
  }
];
