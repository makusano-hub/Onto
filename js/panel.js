// Panel interno: explorar atracciones, probar consultas, validar y preparar individuos nuevos
import { consultarSPARQLDetallado, origenDeDatos, ENDPOINT, ENDPOINT_INFERIDO } from './fuseki.js';
import { validarSHACL } from './shacl.js';
import { CONSULTAS } from './consultas.js';
import { renderizarFicha } from './ficha.js';
import {
  cargarDatos, validarAtraccion, validarGlobal, validarPresenciaEnSitio, probarArchivos,
  peorNivel, GRUPOS
} from './validacion.js';
import { CATEGORIAS, NS, SCHEMA, RAICES, RAIZ_ACTIVIDAD, ID_VALIDO, FORMATOS_MODELO, nombreLegible, nombreClase } from './catalogo.js';

const $ = (id) => document.getElementById(id);

const estado = {
  datos: null,
  hallazgos: new Map(), // id → hallazgos de reglas locales
  extra: new Map(), // id → hallazgos de las comprobaciones en vivo (presencia y archivos)
  shacl: null, // id → hallazgos de las reglas SHACL; null mientras Fuseki no las haya aplicado
  global: [],
  filtros: { comuna: '', categoria: '', falta: '', texto: '' }
};

function el(etiqueta, atributos = {}, ...hijos) {
  const elemento = document.createElement(etiqueta);
  Object.entries(atributos).forEach(([clave, valor]) => {
    if (valor == null || valor === false) return;
    if (clave === 'texto') elemento.textContent = valor;
    else if (clave.startsWith('on')) elemento.addEventListener(clave.slice(2), valor);
    else elemento.setAttribute(clave, valor === true ? '' : valor);
  });
  elemento.append(...hijos.flat().filter((hijo) => hijo != null && hijo !== false));
  return elemento;
}

// Con el resultado de SHACL disponible, sustituye a las reglas equivalentes de validacion.js (marcadas "respaldo"):
// cada regla se evalúa una sola vez y la tabla no puede contradecir al bloque "Reglas SHACL" ni al despliegue.
const hallazgosDe = (id) => [
  ...(estado.hallazgos.get(id) ?? []).filter((h) => !(estado.shacl && h.respaldo)),
  ...(estado.shacl?.get(id) ?? []),
  ...(estado.extra.get(id) ?? [])
];

// Grupo de la tabla al que va un resultado SHACL según la propiedad que incumple; el resto son de ontología
const GRUPO_SHACL = {
  Nombre: 'datos', Descripcion: 'datos', Calificacion: 'datos', Precio: 'datos',
  requierePermisoAutoridad: 'datos', tieneTemporada: 'datos', Latitud: 'datos', Longitud: 'datos',
  tieneModelo3D: 'medios', tieneImagen: 'medios', tieneEnlace: 'medios'
};
const problemas = (lista) => lista.filter(({ nivel }) => nivel !== 'ok');
const relacionesCompletas = (a) => !hallazgosDe(a.id).some(({ grupo, nivel }) => grupo === 'ontologia' && nivel === 'error');

// ---------- Navegación entre vistas

const VISTAS = ['explorar', 'validacion', 'consultas', 'nuevo'];

function mostrarVista() {
  const actual = VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'explorar';
  VISTAS.forEach((vista) => {
    $(`vista-${vista}`).hidden = vista !== actual;
    $(`tab-${vista}`).setAttribute('aria-selected', String(vista === actual));
  });
}
// ---------- Inicio (las llamadas están al final del archivo)

// Quién responde las consultas de esta página: Fuseki o, si no está, el motor SPARQL del navegador
async function comprobarFuseki() {
  const indicador = $('estado-fuseki');
  const enNavegador = (await origenDeDatos()) === 'navegador';
  try {
    const { ms } = await consultarSPARQLDetallado('ASK {}');
    indicador.dataset.estado = enNavegador ? 'navegador' : 'ok';
    indicador.textContent = enNavegador ? 'Sin Fuseki · SPARQL en el navegador' : `Fuseki conectado · ${ms} ms`;
    if (enNavegador) indicador.title = 'Fuseki no responde: las consultas se resuelven en el navegador (Oxigraph) sobre datos/turismo.rdf.';
  } catch (error) {
    indicador.dataset.estado = 'error';
    indicador.textContent = enNavegador ? 'Sin datos' : 'Fuseki sin conexión';
    indicador.title = error.message;
  }
}

async function iniciar() {
  const aviso = $('aviso-carga');
  aviso.hidden = false;
  aviso.textContent = 'Cargando datos…';

  try {
    estado.datos = await cargarDatos();
  } catch (error) {
    console.error(error);
    aviso.textContent = (await origenDeDatos()) === 'navegador'
      ? `Fuseki no responde y el motor SPARQL del navegador no pudo cargar la ontología. Recarga la página o inicia Fuseki. ${error.message}`
      : `No se pudo cargar la ontología desde Fuseki (${ENDPOINT}). Comprueba que esté en ejecución con el dataset "turismo" y recarga. ${error.message}`;
    aviso.dataset.nivel = 'error';
    return;
  }

  aviso.hidden = true;
  validarLocal();
  iniciarExplorar();
  iniciarValidacion();
  iniciarNuevo();
  comprobarPresencia();
  comprobarSHACL();
}

function validarLocal() {
  const { datos } = estado;
  estado.hallazgos = new Map(datos.atracciones.map((a) => [a.id, validarAtraccion(a, datos)]));
  estado.global = validarGlobal(datos);
}

async function comprobarPresencia() {
  const progreso = $('v-progreso');
  try {
    const { resultados } = await validarPresenciaEnSitio(estado.datos, (hechas, total) => {
      progreso.textContent = `Comprobando la portada y las fichas… ${hechas}/${total}`;
    });
    resultados.forEach((lista, id) => {
      const previos = (estado.extra.get(id) ?? []).filter((h) => h.prueba);
      estado.extra.set(id, [...previos, ...lista]);
    });
    progreso.textContent = 'Portada y fichas comprobadas con las mismas consultas del sitio.';
  } catch (error) {
    progreso.textContent = `No se pudo comprobar la portada: ${error.message}`;
  }
  refrescar();
}

// Reglas de ontologia/turismo.shacl.ttl, aplicadas por Fuseki: en vivo o, sin Fuseki, al compilar el sitio.
// Los resultados con el mismo mensaje van en una línea.
async function comprobarSHACL() {
  const aviso = $('v-shacl-estado');
  const lista = $('v-shacl');
  aviso.textContent = 'Validando con SHACL…';
  lista.replaceChildren();
  $('v-shacl-total').textContent = '';

  const enNavegador = (await origenDeDatos()) === 'navegador';
  let resultados;
  try {
    resultados = await validarSHACL();
  } catch (error) {
    aviso.textContent = `${error.sinInforme
      ? 'Las reglas SHACL las aplica Fuseki, que no responde, y este sitio no trae el informe que se guarda al compilar. Inicia Fuseki con fuseki/config.ttl (ver readme.md).'
      : [404, 405].includes(error.estado)
        ? 'Este Fuseki no tiene el endpoint /turismo/shacl. Inícialo con fuseki/config.ttl (ver readme.md).'
        : `No se pudo validar con SHACL: ${error.message}`} La tabla usa las reglas de respaldo de js/validacion.js.`;
    estado.shacl = null;
    refrescar();
    return;
  }

  // Los mismos resultados, repartidos por individuo para la tabla y las tarjetas
  estado.shacl = new Map();
  resultados.forEach(({ nivel, mensaje, individuo, propiedad }) => {
    if (!estado.shacl.has(individuo)) estado.shacl.set(individuo, []);
    estado.shacl.get(individuo).push({ grupo: GRUPO_SHACL[propiedad] ?? 'ontologia', nivel, mensaje, consejo: 'Regla de ontologia/turismo.shacl.ttl.' });
  });
  refrescar();

  const grupos = new Map();
  resultados.forEach(({ nivel, mensaje, individuo }) => {
    const clave = `${nivel} ${mensaje}`;
    if (!grupos.has(clave)) grupos.set(clave, { nivel, mensaje, individuos: [] });
    grupos.get(clave).individuos.push(individuo);
  });

  const cuenta = (nivel) => resultados.filter((resultado) => resultado.nivel === nivel).length;
  $('v-shacl-total').textContent = `(${cuenta('error')} errores, ${cuenta('aviso')} avisos)`;
  const cuando = enNavegador ? 'al compilar el sitio' : 'a los datos cargados';
  aviso.textContent = resultados.length
    ? `Reglas de ontologia/turismo.shacl.ttl, aplicadas por Fuseki ${cuando}.`
    : `Los datos cumplen todas las reglas de ontologia/turismo.shacl.ttl (aplicadas por Fuseki ${cuando}).`;
  lista.replaceChildren(...[...grupos.values()].map(({ nivel, mensaje, individuos }) =>
    el('li', { 'data-nivel': nivel },
      el('span', { class: 'etiqueta-grupo', texto: individuos.length === 1 ? '1 individuo' : `${individuos.length} individuos` }),
      el('span', { texto: mensaje }),
      el('small', { texto: individuos.join(', ') }))));
}

function refrescar() {
  dibujarIndicadores();
  dibujarLista();
  dibujarValidacion();
}

// ---------- Explorar

function iniciarExplorar() {
  const { atracciones } = estado.datos;

  const comunas = new Map();
  atracciones.forEach((a) => a.comunaIds.forEach((id) => comunas.set(id, (comunas.get(id) ?? 0) + 1)));
  const opcionesComuna = [...comunas].map(([id, total]) => ({ id, nombre: nombreLegible(id), total }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const sinComuna = atracciones.filter((a) => !a.comunaIds.length).length;
  if (sinComuna) opcionesComuna.push({ id: '∅', nombre: 'Sin comuna', total: sinComuna });

  const opcionesCategoria = CATEGORIAS.map(({ id, nombre }) => ({
    id, nombre, total: atracciones.filter((a) => a.categorias.includes(id)).length
  }));
  const sinCategoria = atracciones.filter((a) => !a.categorias.length).length;
  if (sinCategoria) opcionesCategoria.push({ id: '∅', nombre: 'Sin categoría', total: sinCategoria });

  const opcionesFalta = [
    { id: 'modelo', nombre: 'Modelo 3D' },
    { id: 'imagen', nombre: 'Imagen' },
    { id: 'relaciones', nombre: 'Relaciones completas' },
    { id: 'descripcion', nombre: 'Descripción' },
    { id: 'enlace', nombre: 'Enlace' }
  ].map((opcion) => ({ ...opcion, total: atracciones.filter((a) => falta(a, opcion.id)).length }));

  crearGrupo($('p-filtro-comuna'), 'comuna', opcionesComuna, 'Todas');
  crearGrupo($('p-filtro-categoria'), 'categoria', opcionesCategoria, 'Todas');
  crearGrupo($('p-filtro-falta'), 'falta', opcionesFalta, 'Sin filtro');

  $('buscar').addEventListener('input', (evento) => {
    estado.filtros.texto = evento.target.value.trim().toLowerCase();
    dibujarLista();
  });

  $('dialogo-cerrar').addEventListener('click', () => $('dialogo-ficha').close());
  $('dialogo-ficha').addEventListener('click', (evento) => {
    if (evento.target === evento.currentTarget) evento.currentTarget.close();
  });
  $('dialogo-ficha').addEventListener('close', () => {
    fichaAbierta?.destruir();
    fichaAbierta = null;
    $('dialogo-contenido').replaceChildren();
  });

  dibujarIndicadores();
  dibujarLista();
}

function crearGrupo(contenedor, campo, opciones, textoTodas) {
  [{ id: '', nombre: textoTodas }, ...opciones].forEach(({ id, nombre, total }) => {
    contenedor.appendChild(el('button', {
      type: 'button',
      class: 'button outline boton-filtro',
      'aria-pressed': String(estado.filtros[campo] === id),
      'data-valor': id,
      disabled: total === 0,
      texto: total === undefined ? nombre : `${nombre} · ${total}`,
      onclick: () => {
        estado.filtros[campo] = id;
        contenedor.querySelectorAll('button').forEach((boton) => boton.setAttribute('aria-pressed', String(boton.dataset.valor === id)));
        dibujarLista();
      }
    }));
  });
}

function falta(a, campo) {
  switch (campo) {
    case 'modelo': return !a.esActividad && !a.modelos.length; // una actividad no lleva modelo
    case 'imagen': return !a.imagenes.length;
    case 'descripcion': return !a.descripcion;
    case 'enlace': return !a.enlaces.length;
    case 'relaciones': return !relacionesCompletas(a);
    default: return true;
  }
}

function visibles() {
  const { comuna, categoria, falta: campoFalta, texto } = estado.filtros;
  return estado.datos.atracciones.filter((a) =>
    (!comuna || (comuna === '∅' ? !a.comunaIds.length : a.comunaIds.includes(comuna))) &&
    (!categoria || (categoria === '∅' ? !a.categorias.length : a.categorias.includes(categoria))) &&
    (!campoFalta || falta(a, campoFalta)) &&
    (!texto || [a.nombre, a.id, a.ciudad, a.comuna, a.descripcion, a.tipo].join(' ').toLowerCase().includes(texto)));
}

function dibujarIndicadores() {
  if (!estado.datos) return;
  const { atracciones } = estado.datos;
  const total = atracciones.length;
  const contar = (condicion) => atracciones.filter(condicion).length;
  const conErrores = contar((a) => peorNivel(hallazgosDe(a.id)) === 'error');

  const indicador = (etiqueta, valor, detalle, nivel) => el('div', { class: 'indicador', 'data-nivel': nivel },
    el('span', { class: 'indicador-etiqueta', texto: etiqueta }),
    el('strong', { texto: valor }),
    detalle && el('span', { class: 'indicador-detalle', texto: detalle }));

  const proporcion = (n) => `${n} de ${total}`;
  // Los modelos se cuentan sobre los lugares: una actividad no puede llevar t:tieneModelo3D
  const lugares = contar((a) => !a.esActividad);
  const conModelo = contar((a) => a.modelos.length);
  const conImagen = contar((a) => a.imagenes.length);
  const relaciones = contar(relacionesCompletas);

  $('indicadores').replaceChildren(
    indicador('Atracciones', String(total), `${CATEGORIAS.filter(({ id }) => atracciones.some((a) => a.categorias.includes(id))).length} de ${CATEGORIAS.length} categorías con contenido`),
    indicador('Con modelo 3D', `${conModelo} de ${lugares} lugares`, `${lugares - conModelo} sin modelo`, conModelo < lugares ? 'aviso' : 'ok'),
    indicador('Con imagen', proporcion(conImagen), `${total - conImagen} sin imagen`, conImagen < total ? 'aviso' : 'ok'),
    indicador('Relaciones completas', proporcion(relaciones), `${total - relaciones} con errores de ontología`, relaciones < total ? 'error' : 'ok'),
    indicador('Con errores', String(conErrores), 'de cualquier tipo', conErrores ? 'error' : 'ok')
  );

  const contador = $('contador-errores');
  contador.hidden = !conErrores;
  contador.textContent = conErrores;
}

function dibujarLista() {
  if (!estado.datos) return;
  const lista = visibles();
  $('p-total').textContent = lista.length === 1 ? '1 atracción' : `${lista.length} atracciones`;
  $('p-lista').replaceChildren(...lista.map(tarjeta));
}

function tarjeta(a) {
  const hallazgos = hallazgosDe(a.id);
  const nivel = peorNivel(hallazgos);
  const presentes = a.completitud.filter(({ presente }) => presente).length;
  const porcentaje = Math.round((presentes / a.completitud.length) * 100);

  const chip = (texto, ok) => el('span', { class: 'chip', 'data-ok': String(ok), texto: `${ok ? '✓' : '✕'} ${texto}` });

  return el('li', {},
    el('button', { type: 'button', class: 'tarjeta-panel', 'data-nivel': nivel, onclick: () => abrirFicha(a) },
      el('span', { class: 'punto-estado', 'aria-label': textoNivel(nivel), title: textoNivel(nivel) }),
      el('h3', { texto: a.nombre }),
      el('p', { texto: a.comuna ? `${a.tipo} · ${a.comuna}` : `${a.tipo} · sin comuna` }),
      el('div', { class: 'chips' },
        !a.esActividad && chip('3D', a.modelos.length > 0),
        chip('Imagen', a.imagenes.length > 0),
        chip('Enlace', a.enlaces.length > 0),
        chip('Relaciones', relacionesCompletas(a))),
      el('div', { class: 'barra-completitud', role: 'img', 'aria-label': `Completitud ${porcentaje}%` },
        el('span', { style: `width:${porcentaje}%` })),
      el('span', { class: 'texto-completitud', texto: `${porcentaje}% completo · ${problemas(hallazgos).length} observaciones` })));
}

const textoNivel = (nivel) => ({ error: 'Con errores', aviso: 'Con avisos', ok: 'Sin problemas' })[nivel];

let fichaAbierta = null;

function abrirFicha(a) {
  const dialogo = $('dialogo-ficha');
  fichaAbierta?.destruir();
  $('dialogo-publica').href = `atraccion.html?id=${encodeURIComponent(a.id)}`;
  if (!dialogo.open) dialogo.showModal();
  fichaAbierta = renderizarFicha($('dialogo-contenido'), a, { nivelTitulo: 'h2' });

  const hallazgos = problemas(hallazgosDe(a.id));
  $('dialogo-pie').replaceChildren(
    el('dl', { class: 'datos-tecnicos' },
      el('div', {}, el('dt', { texto: 'IRI' }), el('dd', {}, el('code', { texto: a.uri }))),
      el('div', {}, el('dt', { texto: 'Clases' }), el('dd', { texto: a.clases.join(', ') })),
      el('div', {}, el('dt', { texto: 'Categorías del sitio' }), el('dd', {
        texto: a.categorias.map((id) => CATEGORIAS.find((c) => c.id === id).nombre).join(', ') || 'ninguna'
      }))),
    el('h3', { texto: hallazgos.length ? `Observaciones (${hallazgos.length})` : 'Sin observaciones' }),
    listaHallazgos(hallazgos));
}

function listaHallazgos(hallazgos) {
  return el('ul', { class: 'lista-hallazgos' }, hallazgos.map(({ grupo, nivel, mensaje, consejo }) =>
    el('li', { 'data-nivel': nivel },
      el('span', { class: 'etiqueta-grupo', texto: GRUPOS[grupo] }),
      el('span', { texto: mensaje }),
      consejo && el('small', { texto: consejo }))));
}

// ---------- Validación

function iniciarValidacion() {
  $('v-revalidar').addEventListener('click', async () => {
    $('v-progreso').textContent = 'Recargando datos…';
    try {
      estado.datos = await cargarDatos();
    } catch (error) {
      $('v-progreso').textContent = `No se pudo recargar: ${error.message}`;
      return;
    }
    estado.extra.clear();
    validarLocal();
    refrescar();
    comprobarPresencia();
    comprobarSHACL();
  });

  $('v-archivos').addEventListener('click', async (evento) => {
    const boton = evento.currentTarget;
    boton.disabled = true;
    const resultados = await probarArchivos(estado.datos.atracciones, (hechas, total) => {
      $('v-progreso').textContent = `Abriendo modelos 3D e imágenes… ${hechas}/${total}`;
    });
    // Sustituye el resultado de una prueba anterior
    resultados.forEach((lista, id) => {
      const previos = (estado.extra.get(id) ?? []).filter((h) => !h.prueba);
      estado.extra.set(id, [...previos, ...lista.map((h) => ({ ...h, prueba: true }))]);
    });
    $('v-progreso').textContent = 'Modelos 3D e imágenes abiertos.';
    boton.disabled = false;
    refrescar();
  });

  $('v-solo-problemas').addEventListener('change', dibujarValidacion);
  $('v-csv').addEventListener('click', descargarCSV);
  dibujarValidacion();
}

function dibujarValidacion() {
  if (!estado.datos) return;
  const { atracciones } = estado.datos;
  const soloProblemas = $('v-solo-problemas').checked;

  const filas = atracciones
    .map((a) => ({ a, hallazgos: hallazgosDe(a.id) }))
    .map((fila) => ({ ...fila, nivel: peorNivel(fila.hallazgos) }))
    .sort((x, y) => ({ error: 0, aviso: 1, ok: 2 }[x.nivel] - { error: 0, aviso: 1, ok: 2 }[y.nivel]) || x.a.nombre.localeCompare(y.a.nombre, 'es'));

  const cuenta = (nivel) => filas.filter((fila) => fila.nivel === nivel).length;
  $('v-resumen').replaceChildren(
    el('span', { class: 'resumen-item', 'data-nivel': 'error' }, el('strong', { texto: cuenta('error') }), ' con errores'),
    el('span', { class: 'resumen-item', 'data-nivel': 'aviso' }, el('strong', { texto: cuenta('aviso') }), ' solo con avisos'),
    el('span', { class: 'resumen-item', 'data-nivel': 'ok' }, el('strong', { texto: cuenta('ok') }), ' sin problemas'));

  const globales = estado.global;
  $('v-global-total').textContent = `(${globales.length})`;
  $('v-global').replaceChildren(...listaHallazgos(globales).children);

  const cabecera = el('div', { class: 'fila-cabecera', 'aria-hidden': 'true' },
    el('span', { texto: 'Atracción' }),
    ...Object.values(GRUPOS).map((nombre) => el('span', { texto: nombre })),
    el('span', { texto: 'Completo' }));

  const visiblesFilas = filas.filter(({ hallazgos }) => !soloProblemas || problemas(hallazgos).length);

  $('v-tabla').replaceChildren(cabecera, ...visiblesFilas.map(({ a, hallazgos, nivel }) => {
    const celdas = Object.keys(GRUPOS).map((grupo) => {
      const delGrupo = problemas(hallazgos.filter((h) => h.grupo === grupo));
      const nivelGrupo = peorNivel(delGrupo);
      return el('span', { class: 'celda-grupo', 'data-nivel': nivelGrupo, 'data-titulo': GRUPOS[grupo] },
        nivelGrupo === 'ok' ? '✓' : `${delGrupo.length}`);
    });
    const presentes = a.completitud.filter(({ presente }) => presente).length;

    return el('details', { class: 'fila-validacion', role: 'listitem', 'data-nivel': nivel },
      el('summary', {},
        el('span', { class: 'celda-nombre' }, el('strong', { texto: a.nombre }), el('small', { texto: `${a.tipo} · ${a.comuna ?? 'sin comuna'}` })),
        ...celdas,
        el('span', { class: 'celda-completitud', texto: `${Math.round((presentes / a.completitud.length) * 100)}%` })),
      el('div', { class: 'detalle-validacion' },
        el('p', { class: 'faltantes', texto: `Falta: ${a.completitud.filter(({ presente }) => !presente).map(({ nombre }) => nombre).join(', ') || 'nada'}` }),
        listaHallazgos(hallazgos),
        el('button', { type: 'button', class: 'button outline', texto: 'Abrir ficha', onclick: () => abrirFicha(a) })));
  }));

  if (!visiblesFilas.length) $('v-tabla').append(el('p', { class: 'vacio', texto: 'Ninguna atracción tiene problemas.' }));
  dibujarIndicadores();
}

function descargarCSV() {
  const columnas = ['id', 'nombre', 'clases', 'categorias', 'comuna', 'ciudad', 'estado', 'errores', 'avisos', 'faltantes', 'observaciones'];
  const celda = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`;
  const filas = estado.datos.atracciones.map((a) => {
    const hallazgos = hallazgosDe(a.id);
    return [
      a.id, a.nombre, a.clases.join(' '), a.categorias.join(' '), a.comuna, a.ciudad, peorNivel(hallazgos),
      hallazgos.filter(({ nivel }) => nivel === 'error').length,
      hallazgos.filter(({ nivel }) => nivel === 'aviso').length,
      a.completitud.filter(({ presente }) => !presente).map(({ nombre }) => nombre).join('; '),
      problemas(hallazgos).map(({ mensaje }) => mensaje).join(' | ')
    ].map(celda).join(',');
  });
  const blob = new Blob([`﻿${[columnas.join(','), ...filas].join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const enlace = el('a', { href: URL.createObjectURL(blob), download: `validacion-ontologia-${new Date().toISOString().slice(0, 10)}.csv` });
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

// ---------- Consultas SPARQL

const LIBRE = { id: 'libre', titulo: 'Consulta libre', usadaEn: 'Solo en el panel', descripcion: 'Escribe cualquier consulta SELECT o ASK sobre el dataset turismo.', texto: () => CONSULTAS[0].texto().split('SELECT')[0] + 'SELECT ?s ?p ?o WHERE {\n  ?s ?p ?o\n}\nLIMIT 50' };
let consultaActual = null;

function iniciarConsultas() {
  const lista = $('c-lista');
  [...CONSULTAS, LIBRE].forEach((consulta) => {
    lista.appendChild(el('li', {}, el('button', {
      type: 'button', 'data-id': consulta.id, 'aria-pressed': 'false', onclick: () => elegirConsulta(consulta)
    }, el('strong', { texto: consulta.titulo }), el('small', { texto: consulta.usadaEn }))));
  });

  $('c-ejecutar').addEventListener('click', ejecutarConsulta);
  $('c-restaurar').addEventListener('click', () => { $('c-texto').value = consultaActual.texto(); });
  $('c-copiar').addEventListener('click', () => copiar($('c-texto').value, $('c-estado')));
  $('c-texto').addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey)) {
      evento.preventDefault();
      ejecutarConsulta();
    }
  });

  elegirConsulta(CONSULTAS[0]);
}

function elegirConsulta(consulta) {
  consultaActual = consulta;
  $('c-lista').querySelectorAll('button').forEach((boton) => boton.setAttribute('aria-pressed', String(boton.dataset.id === consulta.id)));
  $('c-titulo').textContent = consulta.titulo;
  $('c-usada').textContent = `Usada en: ${consulta.usadaEn}`;
  $('c-descripcion').textContent = consulta.descripcion;
  $('c-texto').value = consulta.texto();
  $('c-inferencia').checked = Boolean(consulta.inferencia);
  $('c-error').hidden = true;
  $('c-resultado').replaceChildren();
  $('c-estado').textContent = '';
}

const compactar = (valor) => valor.replace(NS, 't:').replace(SCHEMA, 'schema:').replace('http://www.wikidata.org/entity/', 'wd:').replace('http://www.w3.org/2002/07/owl#', 'owl:').replace('http://www.w3.org/2000/01/rdf-schema#', 'rdfs:').replace('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'rdf:');

async function ejecutarConsulta() {
  const salida = $('c-resultado');
  const error = $('c-error');
  const aviso = $('c-estado');
  // Con inferencia se consulta /turismo-inferido: los mismos datos más lo que deduce el razonador.
  // Sin Fuseki, el motor del navegador consulta el grafo inferido que Fuseki dejó al compilar.
  const inferencia = $('c-inferencia').checked;
  const enNavegador = (await origenDeDatos()) === 'navegador';
  const origen = `${inferencia ? ' · con inferencia' : ''}${enNavegador ? ' · en el navegador' : ''}`;
  error.hidden = true;
  aviso.textContent = 'Ejecutando…';

  try {
    const { variables, filas, booleano, ms } = await consultarSPARQLDetallado($('c-texto').value, inferencia ? ENDPOINT_INFERIDO : ENDPOINT);

    if (booleano !== undefined) {
      aviso.textContent = `ASK · ${ms} ms${origen}`;
      salida.replaceChildren(el('p', { class: 'resultado-ask', texto: booleano ? 'Verdadero' : 'Falso' }));
      return;
    }

    const MAXIMO = 500;
    aviso.textContent = `${filas.length} filas · ${ms} ms${origen}${filas.length > MAXIMO ? ` · se muestran ${MAXIMO}` : ''}`;
    salida.replaceChildren(el('div', { class: 'tabla-scroll' }, el('table', { class: 'tabla-resultados' },
      el('thead', {}, el('tr', {}, variables.map((variable) => el('th', { scope: 'col', texto: `?${variable}` })))),
      el('tbody', {}, filas.slice(0, MAXIMO).map((fila) => el('tr', {}, variables.map((variable) => {
        const valor = fila[variable];
        if (!valor) return el('td', { class: 'sin-valor', texto: '—' });
        return el('td', { 'data-tipo': valor.type, title: valor.value, texto: valor.value.split('␟').map(compactar).join(' ␟ ') });
      })))))));
  } catch (fallo) {
    aviso.textContent = '';
    error.hidden = false;
    error.textContent = inferencia && fallo.estado === 404 && !enNavegador
      ? 'Este Fuseki no tiene el endpoint /turismo-inferido. Inícialo con fuseki/config.ttl (ver readme.md) o desmarca "Con inferencia".'
      : `${fallo.message}\n\n${fallo.detalle ?? ''}`.trim();
    salida.replaceChildren();
  }
}

async function copiar(texto, aviso) {
  try {
    await navigator.clipboard.writeText(texto);
    aviso.textContent = 'Copiado.';
  } catch {
    aviso.textContent = 'No se pudo copiar: selecciona el texto y usa Ctrl+C.';
  }
}

// ---------- Nuevo individuo

let formato = 'turtle';

function iniciarNuevo() {
  const { datos } = estado;
  const formulario = $('n-formulario');
  const campos = formulario.elements;

  const clases = [...datos.padres.keys()]
    .filter((clase) => !RAICES.includes(clase) && RAICES.some((raiz) => ancestrosDe(clase).has(raiz)))
    .sort((a, b) => nombreClase(a).localeCompare(nombreClase(b), 'es'));
  llenarSelect(campos.clase, clases.map((clase) => [clase, `${nombreClase(clase)} (${clase})`]), 'Elige una clase');

  const individuosDe = (tipo) => [...datos.tiposPorIndividuo].filter(([, tipos]) => tipos.includes(tipo)).map(([id]) => id).sort();
  llenarSelect(campos.ciudad, individuosDe('Ciudad').map((id) => [id, nombreLegible(id)]), '—');
  llenarSelect(campos.comuna, individuosDe('Comuna').map((id) => [id, nombreLegible(id)]), '—');
  llenarSelect(campos.lugar, datos.atracciones.filter((a) => !a.esActividad).map((a) => [a.id, a.nombre]), '—');

  const usados = new Set(datos.atracciones.flatMap((a) => a.crudo.modelos));
  $('n-modelos').replaceChildren(...datos.recursos.modelos3d
    .filter((ruta) => FORMATOS_MODELO.some((ext) => ruta.endsWith(`.${ext}`)))
    .sort((a, b) => usados.has(a) - usados.has(b))
    .map((ruta) => el('option', { value: ruta, texto: usados.has(ruta) ? 'ya asignado' : 'sin asignar' })));

  formulario.addEventListener('input', generar);
  formulario.addEventListener('submit', (evento) => evento.preventDefault());
  document.querySelectorAll('[data-formato]').forEach((boton) => boton.addEventListener('click', () => {
    formato = boton.dataset.formato;
    document.querySelectorAll('[data-formato]').forEach((otro) => otro.setAttribute('aria-pressed', String(otro === boton)));
    generar();
  }));
  $('n-copiar').addEventListener('click', () => copiar($('n-salida').textContent, $('n-estado')));
  generar();
}

function ancestrosDe(clase) {
  const vistos = new Set();
  const pendientes = [clase];
  while (pendientes.length) {
    const actual = pendientes.pop();
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    pendientes.push(...(estado.datos.padres.get(actual) ?? []));
  }
  return vistos;
}

function llenarSelect(select, opciones, vacio) {
  select.replaceChildren(el('option', { value: '', texto: vacio }), ...opciones.map(([valor, texto]) => el('option', { value: valor, texto })));
}

const literal = (texto) => `"${texto.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '')}"`;
const lineas = (texto) => texto.split('\n').map((linea) => linea.trim()).filter(Boolean);

function generar() {
  const campos = $('n-formulario').elements;
  const valor = (nombre) => campos[nombre].value.trim();
  const avisos = [];
  const id = valor('id');
  const clase = valor('clase');
  const esActividad = clase && ancestrosDe(clase).has(RAIZ_ACTIVIDAD);

  document.querySelectorAll('[data-para="lugar"]').forEach((etiqueta) => { etiqueta.hidden = Boolean(esActividad); });
  document.querySelectorAll('[data-para="actividad"]').forEach((etiqueta) => { etiqueta.hidden = !esActividad; });

  if (!id) avisos.push(['error', 'Falta el identificador.']);
  else if (!ID_VALIDO.test(id)) avisos.push(['error', 'El identificador solo puede tener letras, números, _ y -.']);
  else if (estado.datos.tiposPorIndividuo.has(id)) avisos.push(['error', `Ya existe un individuo ${id}.`]);
  if (!clase) avisos.push(['error', 'Falta la clase.']);
  if (!valor('nombre')) avisos.push(['aviso', 'Sin nombre: el sitio mostrará el identificador.']);
  if (esActividad && !valor('lugar')) avisos.push(['error', 'Una actividad necesita el lugar donde se realiza.']);
  if (!esActividad && !valor('ciudad') && !valor('comuna')) avisos.push(['error', 'Sin ciudad ni comuna: no aparecerá al filtrar por comuna.']);
  const calificacion = valor('calificacion');
  if (calificacion && !(Number(calificacion) >= 0 && Number(calificacion) <= 5)) avisos.push(['error', 'La calificación debe estar entre 0 y 5.']);
  // Solo los lugares llevan modelo: t:tieneModelo3D tiene dominio t:Lugares y la regla SHACL f:Modelo lo exige
  const modelo = esActividad ? '' : valor('modelo');
  if (modelo && !FORMATOS_MODELO.some((ext) => modelo.toLowerCase().endsWith(`.${ext}`))) avisos.push(['error', 'El modelo debe ser .glb o .gltf.']);
  else if (modelo && !/^https?:/.test(modelo) && !estado.datos.recursos.modelos3d.includes(modelo)) avisos.push(['aviso', `No existe public/${modelo}: cópialo antes de recargar.`]);
  if (!modelo && !esActividad) avisos.push(['aviso', 'Sin modelo 3D.']);
  const imagenes = lineas(valor('imagenes'));
  if (!imagenes.length) avisos.push(['aviso', 'Sin imagen.']);
  imagenes.filter((ruta) => !/^https?:/.test(ruta) && !estado.datos.recursos.imagenes.includes(ruta))
    .forEach((ruta) => avisos.push(['aviso', `No existe public/${ruta}.`]));
  const enlaces = lineas(valor('enlaces'));
  enlaces.filter((url) => !/^https?:\/\//.test(url)).forEach((url) => avisos.push(['error', `Enlace no válido: ${url}`]));

  const sujeto = `t:${ID_VALIDO.test(id) ? id : 'NuevoIndividuo'}`;
  const triples = [`a owl:NamedIndividual${clase ? `, t:${clase}` : ''}`];
  // Los textos llevan su idioma (@es): lo pide la regla SHACL y el rango de la propiedad lo admite (rdf:PlainLiteral)
  if (valor('nombre')) triples.push(`t:Nombre ${literal(valor('nombre'))}@es`);
  if (valor('descripcion')) triples.push(`t:Descripcion ${literal(valor('descripcion'))}@es`);
  if (esActividad && valor('lugar')) triples.push(`t:seRealizaEn t:${valor('lugar')}`);
  if (!esActividad && valor('ciudad')) triples.push(`t:ubicadoEnCiudad t:${valor('ciudad')}`);
  if (!esActividad && valor('comuna')) triples.push(`t:ubicadoEnComuna t:${valor('comuna')}`);
  if (calificacion) triples.push(`t:Calificacion "${Number(calificacion)}"^^xsd:decimal`);
  if (modelo) triples.push(`t:tieneModelo3D ${literal(modelo)}^^xsd:anyURI`);
  imagenes.forEach((ruta) => triples.push(`t:tieneImagen ${literal(ruta)}^^xsd:anyURI`));
  enlaces.forEach((url) => triples.push(`t:tieneEnlace ${literal(url)}^^xsd:anyURI`));

  const cuerpo = `${sujeto} ${triples.join(' ;\n    ')} .`;
  const prefijos = [['t', NS], ['owl', 'http://www.w3.org/2002/07/owl#'], ['xsd', 'http://www.w3.org/2001/XMLSchema#']];

  $('n-salida').textContent = formato === 'turtle'
    ? `${prefijos.map(([p, uri]) => `@prefix ${p}: <${uri}> .`).join('\n')}\n\n${cuerpo}\n`
    : `${prefijos.map(([p, uri]) => `PREFIX ${p}: <${uri}>`).join('\n')}\n\nINSERT DATA {\n  ${cuerpo.replace(/\n/g, '\n  ')}\n}\n`;

  $('n-avisos').replaceChildren(...(avisos.length
    ? avisos.map(([nivel, texto]) => el('li', { 'data-nivel': nivel }, el('span', { texto })))
    : [el('li', { 'data-nivel': 'ok' }, el('span', { texto: 'Listo: este individuo pasará la validación de relaciones.' }))]));
}

window.addEventListener('hashchange', mostrarVista);
mostrarVista();
comprobarFuseki();
iniciarConsultas();
iniciar();
