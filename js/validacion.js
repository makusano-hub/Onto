// Comprueba que cada atracción esté bien conectada a la ontología y se dibuje bien en el sitio.
// No modifica nada: solo consulta (a Fuseki o al motor del navegador) y lee los archivos publicados.
import recursos from 'virtual:recursos';
import { consultarSPARQL } from './fuseki.js';
import { construir, SEP } from './consultas.js';
import { obtenerInventario, buscarAtracciones, obtenerAtraccion } from './ontologia.js';
import { renderizarFicha } from './ficha.js';
import { probarModelo } from './visor3d.js';
import { CATEGORIAS, RAICES, RAIZ_ACTIVIDAD, FORMATOS_MODELO, idDe, nombreLegible, nombreClase } from './catalogo.js';

export const GRUPOS = {
  ontologia: 'Ontología',
  datos: 'Datos',
  medios: 'Modelo e imágenes',
  interfaz: 'Interfaz'
};

const NIVELES = { error: 2, aviso: 1, ok: 0 };

// Por encima de esto un modelo va lento en teléfonos
const TRIANGULOS_MAXIMOS = 1_500_000;

// Campos que cuentan para el porcentaje de completitud
export const CAMPOS_COMPLETITUD = [
  ['nombre', 'Nombre', (a) => a.crudo.nombres.length > 0],
  ['descripcion', 'Descripción', (a) => a.crudo.descripciones.length > 0],
  ['ubicacion', 'Comuna', (a) => a.crudo.comunas.length > 0],
  ['calificacion', 'Calificación', (a) => a.crudo.calificaciones.length > 0],
  ['modelo', 'Modelo 3D', (a) => a.modelos.length > 0],
  ['imagen', 'Imagen', (a) => a.imagenes.length > 0],
  ['enlace', 'Enlace', (a) => a.enlaces.length > 0]
];

const esLocal = (ruta) => !/^https?:\/\//i.test(ruta);
const extension = (ruta) => ruta.split('?')[0].split('.').pop().toLowerCase();

// Descarga todo lo necesario para validar y explorar
export async function cargarDatos() {
  const [atracciones, jerarquia, tipos, ciudades, huerfanos, terminos] = await Promise.all([
    obtenerInventario(),
    consultarSPARQL(construir.jerarquia()),
    consultarSPARQL(construir.tipos()),
    consultarSPARQL(construir.ciudades()),
    consultarSPARQL(construir.huerfanos()),
    consultarSPARQL(construir.identificadores())
  ]);

  const padres = new Map();
  const etiquetas = new Map(); // clase → su rdfs:label en la ontología
  jerarquia.forEach(({ clase, padre, etiqueta }) => {
    const id = idDe(clase);
    if (!padres.has(id)) padres.set(id, new Set());
    if (padre) padres.get(id).add(idDe(padre));
    if (etiqueta) etiquetas.set(id, etiqueta);
  });

  const tiposPorIndividuo = new Map(tipos.map(({ individuo, tipos: lista }) =>
    [idDe(individuo), lista.split(SEP).map(idDe)]));

  const comunaDeCiudad = new Map(ciudades.map(({ ciudad, comunas }) =>
    [idDe(ciudad), comunas ? comunas.split(SEP).map(idDe) : []]));

  // Identificadores ya usados por cualquier término propio (clase, propiedad o individuo, con tipo o sin él)
  const identificadores = new Set(terminos.map(({ termino }) => idDe(termino)));

  const contexto = { padres, etiquetas, tiposPorIndividuo, comunaDeCiudad, identificadores, huerfanos, recursos };
  atracciones.forEach((atraccion) => {
    atraccion.ancestros = ancestros(atraccion.clases, padres);
    atraccion.categorias = CATEGORIAS
      .filter(({ clases }) => clases.some((clase) => atraccion.ancestros.has(clase)))
      .map(({ id }) => id);
    atraccion.esActividad = atraccion.ancestros.has(RAIZ_ACTIVIDAD);
    // El modelo 3D no cuenta en una actividad: t:tieneModelo3D es solo de los lugares
    atraccion.completitud = CAMPOS_COMPLETITUD
      .filter(([id]) => !(id === 'modelo' && atraccion.esActividad))
      .map(([id, nombre, presente]) => ({ id, nombre, presente: presente(atraccion) }));
  });

  return { atracciones, ...contexto };
}

export function ancestros(clases, padres) {
  const vistos = new Set();
  const pendientes = [...clases];
  while (pendientes.length) {
    const clase = pendientes.pop();
    if (vistos.has(clase)) continue;
    vistos.add(clase);
    pendientes.push(...(padres.get(clase) ?? []));
  }
  return vistos;
}

function hallazgo(grupo, nivel, mensaje, consejo = '') {
  return { grupo, nivel, mensaje, consejo };
}

// Reglas que también están en ontologia/turismo.shacl.ttl, sobre el mismo individuo.
// Cuando Fuseki puede aplicar SHACL, el panel muestra el resultado de SHACL y descarta estas (hallazgosDe en
// js/panel.js): así las dos versiones de una regla no pueden dar resultados distintos en la misma pestaña.
// Quedan como respaldo para un Fuseki iniciado sin el endpoint /turismo/shacl.
function respaldo(...argumentos) {
  return { ...hallazgo(...argumentos), respaldo: true };
}

// Reglas que solo necesitan los datos ya descargados
export function validarAtraccion(a, { padres, tiposPorIndividuo, comunaDeCiudad, recursos: archivos }) {
  const h = [];
  const tiene = (individuo, tipo) => tiposPorIndividuo.get(individuo)?.includes(tipo);

  // --- Ontología
  a.clases.forEach((clase) => {
    if (!padres.has(clase)) h.push(hallazgo('ontologia', 'error', `La clase ${clase} no está declarada como owl:Class.`, 'Declárala en Protégé o corrige el rdf:type.'));
  });
  if (!a.categorias.length) {
    h.push(hallazgo('ontologia', 'aviso', 'No pertenece a ninguna categoría del sitio: ningún botón la muestra.', `Añade su clase (${a.clases.join(', ')}) a CATEGORIAS en js/catalogo.js.`));
  }
  if (!a.enEspacioPrincipal) {
    h.push(hallazgo('ontologia', 'aviso', `Su IRI usa otro espacio de nombres (${a.uri.replace(/[#/][^#/]*$/, '')}).`, 'Renómbralo en Protégé para que use el espacio de nombres de la ontología.'));
  }

  // "propia": la regla SHACL equivalente apunta a este mismo individuo. En una actividad, la comuna y la ciudad
  // son las del lugar donde se realiza: SHACL avisa en el lugar y aquí se explica la consecuencia para la actividad.
  const propia = a.esActividad ? hallazgo : respaldo;

  if (a.esActividad) {
    if (!a.lugarIds.length) {
      h.push(respaldo('ontologia', 'error', 'Es una actividad sin lugar (t:seRealizaEn): no tiene comuna ni ciudad.', 'Añade t:seRealizaEn hacia el lugar donde se realiza.'));
    }
    a.lugarIds.forEach((lugar) => {
      if (!tiposPorIndividuo.has(lugar)) h.push(respaldo('ontologia', 'error', `El lugar ${lugar} no existe como individuo con tipo.`, 'Crea el individuo o corrige el nombre.'));
    });
  }

  const ciudadIds = a.crudo.ciudades.map(idDe);
  if (!a.crudo.comunas.length) {
    h.push(propia('ontologia', 'error', 'Sin comuna: no aparece al filtrar por comuna.',
      a.esActividad ? 'El lugar donde se realiza necesita t:ubicadoEnCiudad o t:ubicadoEnComuna.' : 'Añade t:ubicadoEnCiudad (con una ciudad que tenga comuna) o t:ubicadoEnComuna.'));
  }
  if (!ciudadIds.length && !a.esActividad) {
    h.push(hallazgo('ontologia', 'aviso', 'Sin ciudad (t:ubicadoEnCiudad).'));
  }
  ciudadIds.forEach((ciudad) => {
    if (!tiene(ciudad, 'Ciudad')) h.push(propia('ontologia', 'error', `${ciudad} se usa como ciudad pero no es de tipo t:Ciudad.`));
    else if (!comunaDeCiudad.get(ciudad)?.length) h.push(hallazgo('ontologia', 'error', `La ciudad ${ciudad} no tiene t:perteneceAComuna.`));
  });
  a.comunaIds.forEach((comuna) => {
    if (!tiene(comuna, 'Comuna')) h.push(hallazgo('ontologia', 'error', `${comuna} se usa como comuna pero no es de tipo t:Comuna.`));
  });
  if (a.comunaIds.length > 1 && !a.esActividad) {
    h.push(respaldo('ontologia', 'error', `Tiene ${a.comunaIds.length} comunas distintas (${a.comunaIds.join(', ')}).`, 'Revisa que t:ubicadoEnComuna coincida con la comuna de su ciudad.'));
  }

  // --- Datos
  if (!a.crudo.nombres.length) h.push(respaldo('datos', 'aviso', `Sin t:Nombre: se muestra "${a.nombre}", generado desde el IRI.`));
  if (a.crudo.nombres.length > 1) h.push(respaldo('datos', 'aviso', `Tiene ${a.crudo.nombres.length} nombres; la interfaz muestra solo uno.`));
  if (!a.crudo.descripciones.length) h.push(hallazgo('datos', 'aviso', 'Sin t:Descripcion.'));
  if (a.crudo.descripciones.length > 1) h.push(respaldo('datos', 'aviso', `Tiene ${a.crudo.descripciones.length} descripciones; la interfaz muestra solo una.`));
  if (!a.crudo.calificaciones.length) h.push(hallazgo('datos', 'aviso', 'Sin t:Calificacion.'));
  a.crudo.calificaciones.forEach((valor) => {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < 0 || numero > 5) h.push(respaldo('datos', 'error', `Calificación fuera de rango: ${valor} (debe estar entre 0 y 5).`));
  });
  if (a.crudo.calificaciones.length > 1) h.push(respaldo('datos', 'aviso', `Tiene ${a.crudo.calificaciones.length} calificaciones distintas.`));
  a.crudo.precios.forEach((valor) => {
    if (!/^\d+$/.test(valor)) h.push(respaldo('datos', 'error', `Precio no válido: ${valor} (debe ser un entero sin signo).`));
  });

  // --- Modelo, imágenes y enlaces
  if (!a.modelos.length && !a.esActividad) h.push(hallazgo('medios', 'aviso', 'Sin modelo 3D (t:tieneModelo3D).', 'Copia el .glb a public/modelos3d/ y añade t:tieneModelo3D "modelos3d/archivo.glb".'));
  a.crudo.modelos.forEach((ruta) => {
    if (!FORMATOS_MODELO.includes(extension(ruta))) {
      h.push(respaldo('medios', 'error', `El modelo ${ruta} es .${extension(ruta)}; el visor solo abre ${FORMATOS_MODELO.join(' y ')}.`, 'Conviértelo a .glb (por ejemplo con Blender).'));
    } else if (esLocal(ruta) && !archivos.modelos3d.includes(ruta.replace(/^\/+/, ''))) {
      h.push(hallazgo('medios', 'error', `El archivo ${ruta} no existe en public/.`, 'Revisa el nombre (distingue mayúsculas) o copia el archivo.'));
    }
  });
  if (!a.imagenes.length) h.push(hallazgo('medios', 'aviso', 'Sin imagen (t:tieneImagen).', 'Copia la imagen a public/imagenes/ y añade t:tieneImagen "imagenes/archivo.jpg".'));
  a.crudo.imagenes.forEach((ruta) => {
    if (esLocal(ruta) && !archivos.imagenes.includes(ruta.replace(/^\/+/, ''))) {
      h.push(hallazgo('medios', 'error', `La imagen ${ruta} no existe en public/.`));
    }
  });
  if (!a.enlaces.length) h.push(hallazgo('medios', 'aviso', 'Sin enlaces (t:tieneEnlace).'));
  a.crudo.enlaces.forEach((url) => {
    if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url)) h.push(respaldo('medios', 'error', `Enlace mal formado: ${url}`));
  });

  // --- Interfaz: se dibuja la ficha real (sin visor) y se compara con los datos
  h.push(...validarFichaDibujada(a));

  return h;
}

function validarFichaDibujada(a) {
  const h = [];
  const caja = document.createElement('div');
  renderizarFicha(caja, a, { visor: false, nivelTitulo: 'h2' });
  const campo = (nombre) => caja.querySelector(`[data-campo="${nombre}"]`);

  if (campo('nombre')?.textContent !== a.nombre) h.push(hallazgo('interfaz', 'error', 'El título de la ficha no coincide con el nombre.'));
  if (a.comuna && !campo('categoria')?.textContent.includes(a.comuna)) h.push(hallazgo('interfaz', 'error', 'La ficha no muestra la comuna.'));
  if (a.descripcion && !campo('descripcion')) h.push(hallazgo('interfaz', 'error', 'La ficha no muestra la descripción.'));
  if (a.calificacion && !campo('calificacion')) h.push(hallazgo('interfaz', 'error', 'La ficha no muestra la calificación.'));
  if (caja.querySelectorAll('[data-campo="imagenes"] img').length !== a.imagenes.length) h.push(hallazgo('interfaz', 'error', 'La ficha no muestra todas las imágenes.'));
  if (caja.querySelectorAll('[data-campo="enlaces"] a').length !== a.enlaces.length) h.push(hallazgo('interfaz', 'error', 'La ficha no muestra todos los enlaces.'));
  if (/undefined|null|NaN/.test(caja.textContent)) h.push(hallazgo('interfaz', 'error', 'La ficha muestra "undefined", "null" o "NaN".'));
  return h;
}

// Comprueba con las mismas consultas de la portada y de atraccion.html que cada atracción aparece donde debe
export async function validarPresenciaEnSitio(datos, alAvanzar = () => {}) {
  const { atracciones } = datos;
  const porId = new Map(atracciones.map((a) => [a.id, a]));
  const resultados = new Map(atracciones.map((a) => [a.id, []]));
  const tareas = [];

  CATEGORIAS.forEach((categoria) => tareas.push(async () => {
    const ids = new Set((await buscarAtracciones({ categoria: categoria.id })).map(({ id }) => id));
    atracciones.filter((a) => a.categorias.includes(categoria.id)).forEach((a) => {
      if (!ids.has(a.id)) resultados.get(a.id).push(hallazgo('interfaz', 'error', `No aparece al pulsar el botón "${categoria.nombre}".`));
    });
  }));

  [...new Set(atracciones.flatMap((a) => a.comunaIds))].forEach((comuna) => tareas.push(async () => {
    const ids = new Set((await buscarAtracciones({ comuna })).map(({ id }) => id));
    atracciones.filter((a) => a.comunaIds.includes(comuna)).forEach((a) => {
      if (!ids.has(a.id)) resultados.get(a.id).push(hallazgo('interfaz', 'error', `No aparece al filtrar por la comuna ${nombreLegible(comuna)}.`));
    });
  }));

  atracciones.forEach((a) => tareas.push(async () => {
    const ficha = await obtenerAtraccion(a.id).catch(() => null);
    if (!ficha) resultados.get(a.id).push(hallazgo('interfaz', 'error', 'atraccion.html no encuentra esta atracción.', 'Su identificador tiene caracteres no admitidos o está repetido.'));
    else if (ficha.uri !== a.uri) resultados.get(a.id).push(hallazgo('interfaz', 'error', `atraccion.html abre otro individuo con el mismo identificador (${ficha.uri}).`));
  }));

  await enParalelo(tareas, 6, alAvanzar);
  return { resultados, porId };
}

// Descarga cada modelo e imagen para comprobar que de verdad se abren
export async function probarArchivos(atracciones, alAvanzar = () => {}) {
  const resultados = new Map(atracciones.map((a) => [a.id, []]));
  const tareas = [];

  atracciones.forEach((a) => {
    a.modelos.filter(({ original }) => FORMATOS_MODELO.includes(extension(original))).forEach((modelo) => tareas.push(async () => {
      try {
        const prueba = await probarModelo(modelo.ruta);
        const resumen = `${prueba.mallas} mallas, ${prueba.triangulos.toLocaleString('es-CL')} triángulos, ${prueba.ms} ms`;
        resultados.get(a.id).push(prueba.vacio
          ? hallazgo('medios', 'error', `El modelo ${modelo.original} se abre pero está vacío.`)
          : prueba.triangulos > TRIANGULOS_MAXIMOS
            ? hallazgo('medios', 'aviso', `Modelo ${modelo.original} pesado para móviles: ${resumen}.`, `Simplifícalo por debajo de ${TRIANGULOS_MAXIMOS.toLocaleString('es-CL')} triángulos (Blender → Decimate).`)
            : hallazgo('medios', 'ok', `Modelo ${modelo.original}: ${resumen}.`));
      } catch (error) {
        resultados.get(a.id).push(hallazgo('medios', 'error', `El modelo ${modelo.original} no se pudo abrir con Three.js: ${error.message ?? error}`));
      }
    }));
    a.imagenes.forEach((imagen) => tareas.push(async () => {
      const carga = await cargarImagen(imagen.ruta);
      resultados.get(a.id).push(carga
        ? hallazgo('medios', 'ok', `Imagen ${imagen.original}: ${carga.ancho}×${carga.alto} px.`)
        : hallazgo('medios', 'error', `La imagen ${imagen.original} no se pudo cargar.`));
    }));
  });

  // Los modelos pesan: de dos en dos para no saturar la memoria
  await enParalelo(tareas, 2, alAvanzar);
  return resultados;
}

function cargarImagen(ruta) {
  return new Promise((resolver) => {
    const imagen = new Image();
    imagen.onload = () => resolver({ ancho: imagen.naturalWidth, alto: imagen.naturalHeight });
    imagen.onerror = () => resolver(null);
    imagen.src = ruta;
  });
}

async function enParalelo(tareas, limite, alAvanzar) {
  let siguiente = 0;
  let hechas = 0;
  const trabajar = async () => {
    while (siguiente < tareas.length) {
      const tarea = tareas[siguiente++];
      await tarea();
      alAvanzar(++hechas, tareas.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, trabajar));
}

// Problemas que no son de una atracción concreta
export function validarGlobal({ atracciones, huerfanos, comunaDeCiudad, etiquetas, recursos: archivos }) {
  const h = [];

  // El nombre que muestra el sitio (NOMBRES_CLASE en js/catalogo.js) debe ser el rdfs:label de la ontología
  etiquetas.forEach((etiqueta, clase) => {
    if (nombreClase(clase) !== etiqueta) {
      h.push(hallazgo('ontologia', 'aviso', `La clase ${clase} se muestra como "${nombreClase(clase)}", pero su rdfs:label es "${etiqueta}".`, 'Iguala NOMBRES_CLASE en js/catalogo.js con la etiqueta de la ontología (o al revés).'));
    }
  });

  CATEGORIAS.forEach(({ id, nombre, clases }) => {
    if (!atracciones.some((a) => a.categorias.includes(id))) {
      h.push(hallazgo('ontologia', 'aviso', `La categoría "${nombre}" no tiene individuos (clases: ${clases.join(', ')}).`, 'Crea individuos de esa clase o ajusta CATEGORIAS en js/catalogo.js.'));
    }
  });

  comunaDeCiudad.forEach((comunas, ciudad) => {
    if (!comunas.length) h.push(hallazgo('ontologia', 'error', `La ciudad ${ciudad} no tiene t:perteneceAComuna.`));
  });

  const vistos = new Map();
  huerfanos.forEach(({ individuo, tipo }) => {
    const id = idDe(individuo);
    if (!vistos.has(id)) vistos.set(id, new Set());
    if (tipo) vistos.get(id).add(idDe(tipo));
  });
  vistos.forEach((tipos, id) => {
    // Ciudades, comunas y provincias tienen nombre o ubicación pero no son atracciones: no se avisan
    if ([...tipos].some((tipo) => ['Ciudad', 'Comuna', 'Provincias'].includes(tipo))) return;
    h.push(hallazgo('ontologia', 'aviso', `${id} tiene datos de atracción pero el sitio no lo muestra (tipo: ${[...tipos].join(', ') || 'ninguno'}).`, `Su clase debe descender de ${RAICES.join(', ')}.`));
  });

  const usados = new Set(atracciones.flatMap((a) => [...a.crudo.modelos, ...a.crudo.imagenes]).map((ruta) => ruta.replace(/^\/+/, '')));
  [...archivos.modelos3d, ...archivos.imagenes].forEach((ruta) => {
    if (!usados.has(ruta)) h.push(hallazgo('medios', 'aviso', `public/${ruta} no lo usa ningún individuo.`, 'Asígnalo con t:tieneModelo3D / t:tieneImagen o bórralo.'));
  });

  const ids = new Map();
  atracciones.forEach((a) => ids.set(a.id, (ids.get(a.id) ?? 0) + 1));
  ids.forEach((veces, id) => {
    if (veces > 1) h.push(hallazgo('interfaz', 'error', `Hay ${veces} individuos con el identificador ${id}: atraccion.html solo puede abrir uno.`));
  });

  return h;
}

export function peorNivel(hallazgos) {
  return hallazgos.reduce((peor, { nivel }) => (NIVELES[nivel] > NIVELES[peor] ? nivel : peor), 'ok');
}
