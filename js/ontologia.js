import rdfTexto from '../ontologia/turismo.rdf?raw';

const NS_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const NS_RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const NS_OWL = 'http://www.w3.org/2002/07/owl#';

// Clases de la ontología que cuentan como atracción turística
const CLASES_ATRACCION = ['CulturalHistorico', 'ZonaTuristica'];

// Nombre de cada botón de tipo; otra clase nueva usa su propio nombre
const NOMBRES_TIPO = {
  Estatua: 'Monumentos',
  Museo: 'Museos',
  SitioHistorico: 'Sitios históricos',
  Lago: 'Lagos',
  Montaña: 'Montañas',
  Parque: 'Parques',
  Reserva: 'Reservas',
  Rio: 'Ríos'
};

const documento = new DOMParser().parseFromString(rdfTexto, 'application/xml');
const superclases = leerSuperclases();
const individuos = leerIndividuos();

export const atracciones = [...individuos.values()]
  .filter((individuo) => esAtraccion(individuo.clase))
  .map(crearAtraccion)
  // Primero las que ya tienen modelo 3D
  .sort((a, b) => Boolean(b.modelo) - Boolean(a.modelo) || a.nombre.localeCompare(b.nombre, 'es'));

function idDe(uri) {
  return uri.split('#').pop();
}

function leerSuperclases() {
  const resultado = new Map();

  for (const clase of documento.getElementsByTagNameNS(NS_OWL, 'Class')) {
    const superclase = clase.getElementsByTagNameNS(NS_RDFS, 'subClassOf')[0];
    if (superclase) {
      resultado.set(
        idDe(clase.getAttributeNS(NS_RDF, 'about')),
        idDe(superclase.getAttributeNS(NS_RDF, 'resource'))
      );
    }
  }

  return resultado;
}

function leerIndividuos() {
  const resultado = new Map();

  for (const elemento of documento.getElementsByTagNameNS(NS_OWL, 'NamedIndividual')) {
    const uri = elemento.getAttributeNS(NS_RDF, 'about');
    const individuo = { id: idDe(uri), uri, clase: null, valores: {} };

    for (const propiedad of elemento.children) {
      const recurso = propiedad.getAttributeNS(NS_RDF, 'resource');

      if (propiedad.namespaceURI === NS_RDF && propiedad.localName === 'type') {
        individuo.clase = idDe(recurso);
      } else {
        individuo.valores[propiedad.localName] = recurso ? idDe(recurso) : propiedad.textContent.trim();
      }
    }

    resultado.set(individuo.id, individuo);
  }

  return resultado;
}

function esAtraccion(clase) {
  for (let actual = clase; actual; actual = superclases.get(actual)) {
    if (CLASES_ATRACCION.includes(actual)) return true;
  }
  return false;
}

// Convierte "PuertoHambre" o "Isla_Magdalena" en un nombre legible
function nombreLegible(id) {
  const texto = id
    .replace(/_/g, ' ')
    .replace(/([a-zñ])([A-Z])/g, '$1 $2')
    .replace(/\s(De|Del|La|Las|Los)\s/g, (conector) => conector.toLowerCase());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// La comuna puede estar indicada directamente o a través de la ciudad
function buscarComuna({ valores }) {
  const ciudad = individuos.get(valores.ubicadoEnCiudad);
  const comuna = valores.ubicadoEnComuna ?? ciudad?.valores.perteneceAComuna;
  return comuna ? nombreLegible(comuna) : null;
}

function crearAtraccion(individuo) {
  const { id, uri, clase, valores } = individuo;

  return {
    id,
    uri,
    nombre: valores.Nombre ?? nombreLegible(id),
    tipo: NOMBRES_TIPO[clase] ?? nombreLegible(clase),
    comuna: buscarComuna(individuo),
    descripcion: valores.Descripcion ?? '',
    calificacion: valores.Calificacion ?? null,
    precio: valores.Precio ?? null,
    requierePermiso: valores.requierePermisoAutoridad ?? null,
    tieneTemporada: valores.tieneTemporada ?? null,
    modelo: valores.tieneModelo3D ? `${import.meta.env.BASE_URL}${valores.tieneModelo3D}` : null
  };
}
